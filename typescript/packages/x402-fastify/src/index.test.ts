import Fastify, { type FastifyInstance } from 'fastify';
import type { X402Config } from '@cryptonly/x402';
import {
  BASE_SEPOLIA,
  PERMIT2_TOKEN,
  USDC,
  resource,
  twoPriceConfig,
  x402Config,
} from '../../x402/src/config.fixture.js';
import {
  FACILITATOR_BASE_URL,
  decodeHeader,
  facilitatorFetch,
  muteBazaarImportLog,
  paymentFor,
  type FacilitatorCalls,
} from '../../x402/src/facilitator.fixture.js';
import { cryptonlyPayments } from './index.js';

const priced = (amount: string): X402Config =>
  x402Config({
    resources: [
      resource({
        path: '/weather/:city',
        prices: [
          {
            amount,
            asset: resource().prices[0].asset,
            currencyCode: 'USDC_BASE',
            network: BASE_SEPOLIA,
          },
        ],
      }),
    ],
  });

type Reply = X402Config | Error;

/** A `fetch` for `GET /x402/config` that answers from a queue (last one repeats). */
function configFetch(...replies: Reply[]) {
  const queue = [...replies];
  return jest.fn(async () => {
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply), { status: 200 });
  });
}

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('cryptonlyPayments (Fastify)', () => {
  const realFetch = globalThis.fetch;
  const calls: FacilitatorCalls = { verified: [], settled: [] };
  let app: FastifyInstance | undefined;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    calls.verified.length = 0;
    calls.settled.length = 0;
    consoleError = muteBazaarImportLog();
    globalThis.fetch = facilitatorFetch(calls, realFetch);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    globalThis.fetch = realFetch;
    consoleError.mockRestore();
  });

  async function start(fetchConfig: ReturnType<typeof configFetch>, retryAfterMs = 5_000) {
    app = Fastify();
    await app.register(cryptonlyPayments, {
      apiKey: 'k',
      baseUrl: FACILITATOR_BASE_URL,
      fetch: fetchConfig as unknown as typeof fetch,
      logger: silentLogger,
      refreshIntervalMs: 0,
      retryAfterMs,
    });
    app.get('/weather/:city', async (request, reply) => {
      const { city } = request.params as { city: string };
      if (city === 'nowhere') return reply.status(404).send({ error: 'unknown city' });
      if (city === 'boom') throw new Error('handler failed');
      return { city, temperatureC: 21 };
    });
    app.get('/free', async () => ({ free: true }));
    await app.ready();
    return app;
  }

  async function pay(path: string) {
    const unpaid = await app!.inject({ method: 'GET', url: path });
    expect(unpaid.statusCode).toBe(402);
    return app!.inject({
      method: 'GET',
      url: path,
      headers: {
        'payment-signature': paymentFor(String(unpaid.headers['payment-required'])),
      },
    });
  }

  it('answers 402 on a dashboard route and passes free routes through', async () => {
    await start(configFetch(priced('1000')));

    const unpaid = await app!.inject({ method: 'GET', url: '/weather/lisbon' });
    expect(unpaid.statusCode).toBe(402);
    const required = decodeHeader(String(unpaid.headers['payment-required']));
    expect(required.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'eip155:84532',
      amount: '1000',
      payTo: priced('1000').payTo.address,
    });

    const free = await app!.inject({ method: 'GET', url: '/free' });
    expect(free.statusCode).toBe(200);
    expect(free.json()).toEqual({ free: true });
  });

  it('puts the service metadata and the bazaar declaration in the 402', async () => {
    const config = priced('1000');
    config.resources[0] = { ...config.resources[0], discoverable: true, tags: ['weather'] };
    await start(configFetch(config));

    const unpaid = await app!.inject({ method: 'GET', url: '/weather/lisbon' });
    const required = decodeHeader(String(unpaid.headers['payment-required']));
    expect(required.resource).toMatchObject({
      serviceName: 'Weather API',
      iconUrl: 'https://cdn.example.com/icon.png',
      tags: ['weather'],
    });
    expect(required.extensions.bazaar).toMatchObject({
      routeTemplate: '/weather/:city',
      info: { input: { type: 'http', method: 'GET', pathParams: { city: 'lisbon' } } },
    });
  });

  it('offers every dashboard price and settles the one the buyer picked', async () => {
    await start(configFetch(twoPriceConfig('/weather/:city')));

    const unpaid = await app!.inject({ method: 'GET', url: '/weather/lisbon' });
    const header = String(unpaid.headers['payment-required']);
    expect(decodeHeader(header).accepts).toEqual([
      expect.objectContaining({ asset: USDC, amount: '1000' }),
      expect.objectContaining({ asset: PERMIT2_TOKEN, amount: '5' }),
    ]);

    const paid = await app!.inject({
      method: 'GET',
      url: '/weather/lisbon',
      headers: { 'payment-signature': paymentFor(header, 1) },
    });
    expect(paid.statusCode).toBe(200);
    expect(calls.settled).toEqual([
      expect.objectContaining({
        paymentRequirements: expect.objectContaining({
          asset: PERMIT2_TOKEN,
          amount: '5',
        }),
      }),
    ]);
  });

  it('runs the handler, then settles once, when the payment verifies', async () => {
    await start(configFetch(priced('1000')));
    const paid = await pay('/weather/lisbon');
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toEqual({ city: 'lisbon', temperatureC: 21 });
    expect(paid.headers['payment-response']).toBeTruthy();
    expect(calls.verified).toHaveLength(1);
    expect(calls.settled).toHaveLength(1);
  });

  it.each([
    ['answers 4xx', '/weather/nowhere', 404],
    ['throws', '/weather/boom', 500],
  ])('does not settle when the handler %s', async (_case, path, status) => {
    await start(configFetch(priced('1000')));
    const failed = await pay(path);
    expect(failed.statusCode).toBe(status);
    expect(calls.verified).toHaveLength(1);
    expect(calls.settled).toHaveLength(0);
  });

  it('answers 503 until a first load succeeds, then serves', async () => {
    const fetchConfig = configFetch(new Error('ECONNREFUSED'), priced('1000'));
    await start(fetchConfig, 0);

    const failed = await app!.inject({ method: 'GET', url: '/free' });
    expect(failed.statusCode).toBe(503);
    expect(failed.headers['retry-after']).toBe('0');
    expect(failed.json()).toMatchObject({ error: 'x402_config_unavailable' });

    const served = await app!.inject({ method: 'GET', url: '/free' });
    expect(served.statusCode).toBe(200);
    expect(fetchConfig).toHaveBeenCalledTimes(2);
  });

  it('gates only the scope it is registered in', async () => {
    app = Fastify();
    app.get('/health', async () => 'ok');
    await app.register(async (paid) => {
      await paid.register(cryptonlyPayments, {
        apiKey: 'k',
        baseUrl: FACILITATOR_BASE_URL,
        fetch: configFetch(new Error('ECONNREFUSED')) as unknown as typeof fetch,
        logger: silentLogger,
        refreshIntervalMs: 0,
      });
      paid.get('/weather/:city', async () => ({ temperatureC: 21 }));
      await expect(paid.cryptonlyX402.ready()).rejects.toThrow('ECONNREFUSED');
    });
    await app.ready();

    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/weather/lisbon' })).statusCode).toBe(503);
  });

  it('serves the new price after a refresh', async () => {
    await start(configFetch(priced('1000'), priced('2500')));
    await app!.cryptonlyX402.ready();
    await expect(app!.cryptonlyX402.refresh()).resolves.toBe(true);

    const unpaid = await app!.inject({ method: 'GET', url: '/weather/lisbon' });
    expect(decodeHeader(String(unpaid.headers['payment-required'])).accepts[0].amount).toBe(
      '2500',
    );
    const paid = await pay('/weather/lisbon');
    expect(paid.statusCode).toBe(200);
    expect(calls.settled).toHaveLength(1);
  });
});
