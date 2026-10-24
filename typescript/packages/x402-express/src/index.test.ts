import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { RoutesConfig } from '@x402/core/server';
import { MERCHANT_API_KEY_HEADER, type X402Config } from '@cryptonly/x402';
import { resource, x402Config } from '../../x402/src/config.fixture.js';
import {
  cryptonlyPaymentMiddleware,
  type CryptonlyPaymentMiddleware,
  type ExpressMiddleware,
  type InnerMiddlewareFactory,
} from './index.js';

type Reply = { status: number; body: unknown } | Error;

/** A `fetch` that answers `GET /x402/config` from a queue (last one repeats). */
function configFetch(...replies: Reply[]) {
  const queue = [...replies];
  return jest.fn(async (_url: string, _init?: RequestInit) => {
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
}

const ok = (config: X402Config): Reply => ({ status: 200, body: config });

function mockResponse() {
  const res = {
    headersSent: false,
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      res.headersSent = true;
      return res;
    },
  };
  return res;
}

/** Inner factory whose handlers record the routes they were built for. */
function recordingFactory() {
  const served: RoutesConfig[] = [];
  const factory = jest.fn<ExpressMiddleware, Parameters<InnerMiddlewareFactory>>(
    (routes) => (_req, _res, next) => {
      served.push(routes);
      next();
    },
  );
  return { factory, served };
}

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

async function call(middleware: CryptonlyPaymentMiddleware) {
  const res = mockResponse();
  const next = jest.fn() as unknown as NextFunction;
  await middleware({} as Request, res as unknown as Response, next);
  return { res, next };
}

const priced = (amount: string) =>
  x402Config({
    resources: [
      resource({
        price: { amount, asset: resource().price.asset, currencyCode: 'USDC_BASE' },
      }),
    ],
  });

function amountOf(routes: RoutesConfig | undefined): string | undefined {
  const route = (routes as Record<string, { accepts: { price: { amount: string } } }>)?.[
    'GET /weather'
  ];
  return route?.accepts.price.amount;
}

describe('cryptonlyPaymentMiddleware', () => {
  let middleware: CryptonlyPaymentMiddleware | undefined;
  afterEach(() => {
    middleware?.close();
    middleware = undefined;
    jest.useRealTimers();
  });

  it('loads the config once on first use and serves its routes', async () => {
    const fetchMock = configFetch(ok(priced('1000')));
    const { factory, served } = recordingFactory();
    middleware = cryptonlyPaymentMiddleware({
      apiKey: 'key-1',
      baseUrl: 'http://api.test',
      fetch: fetchMock as unknown as typeof fetch,
      createMiddleware: factory,
      logger: silentLogger,
    });

    const [first, second] = await Promise.all([call(middleware), call(middleware)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/x402/config');
    expect((init?.headers as Record<string, string>)[MERCHANT_API_KEY_HEADER]).toBe(
      'key-1',
    );
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0][1].config.network).toBe('eip155:84532');
    expect(factory.mock.calls[0][1].schemes.map((s) => s.scheme)).toEqual(['exact']);
    expect(first.next).toHaveBeenCalled();
    expect(second.next).toHaveBeenCalled();
    expect(served.map(amountOf)).toEqual(['1000', '1000']);
  });

  it('answers 503 until a first load succeeds, then serves', async () => {
    const fetchMock = configFetch(
      { status: 401, body: { message: 'invalid key' } },
      ok(priced('1000')),
    );
    const { factory } = recordingFactory();
    middleware = cryptonlyPaymentMiddleware({
      apiKey: 'k',
      fetch: fetchMock as unknown as typeof fetch,
      createMiddleware: factory,
      logger: silentLogger,
      retryAfterMs: 0,
    });

    const failed = await call(middleware);
    expect(failed.res.statusCode).toBe(503);
    expect(failed.res.body).toMatchObject({ error: 'x402_config_unavailable' });
    expect(failed.next).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();

    const served = await call(middleware);
    expect(served.next).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('builds the stock @x402/express middleware by default', async () => {
    const fetchMock = configFetch(ok(x402Config({ resources: [] })));
    middleware = cryptonlyPaymentMiddleware({
      apiKey: 'k',
      baseUrl: 'http://api.test',
      fetch: fetchMock as unknown as typeof fetch,
      logger: silentLogger,
      refreshIntervalMs: 0,
    });
    // No paid routes: the stock middleware passes every request through.
    // (It also syncs `/supported` in the background; silence that call.)
    const realFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(
      async () => new Response(JSON.stringify({ kinds: [], extensions: [], signers: {} })),
    ) as unknown as typeof fetch;
    try {
      await middleware.ready();
      const res = mockResponse();
      const next = jest.fn();
      await middleware(
        {
          path: '/free',
          method: 'GET',
          headers: {},
          header: () => undefined,
        } as unknown as Request,
        res as unknown as Response,
        next,
      );
      expect(next).toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('answers 402 for a dashboard route through the stock middleware', async () => {
    // Under jest's VM the stock middleware cannot `import()` the bazaar
    // extension and logs it; plain Node loads it.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const realFetch = globalThis.fetch;
    // The facilitator's `/supported`; everything else goes to the network.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'http://api.test/x402/supported') {
        return new Response(
          JSON.stringify({
            kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }],
            extensions: [],
            signers: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return realFetch(input as string, init);
    }) as typeof fetch;

    const config = x402Config({
      resources: [
        resource({ path: '/weather/:city', discoverable: true }),
        resource({
          path: '/report',
          price: {
            amount: '5',
            asset: '0x1111111111111111111111111111111111111111',
            currencyCode: 'TKN_BASE',
          },
        }),
      ],
    });
    middleware = cryptonlyPaymentMiddleware({
      apiKey: 'k',
      baseUrl: 'http://api.test',
      fetch: configFetch(ok(config)) as unknown as typeof fetch,
      logger: silentLogger,
      refreshIntervalMs: 0,
    });
    const app = express();
    app.use(middleware);
    app.get('/weather/:city', (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/free', (_req, res) => {
      res.json({ free: true });
    });
    const server = app.listen(0);
    try {
      await new Promise((resolve) => server.once('listening', resolve));
      const { port } = server.address() as AddressInfo;

      const paid = await realFetch(`http://127.0.0.1:${port}/weather/lisbon`);
      expect(paid.status).toBe(402);
      const header = paid.headers.get('payment-required');
      expect(header).toBeTruthy();
      const required = JSON.parse(Buffer.from(header!, 'base64').toString('utf8'));
      expect(required.accepts[0]).toMatchObject({
        scheme: 'exact',
        network: 'eip155:84532',
        amount: '1000',
        payTo: config.payTo.address,
        extra: { name: 'USDC', version: '2' },
      });

      const permit2 = await realFetch(`http://127.0.0.1:${port}/report`);
      expect(permit2.status).toBe(402);
      const permit2Required = JSON.parse(
        Buffer.from(permit2.headers.get('payment-required')!, 'base64').toString('utf8'),
      );
      expect(permit2Required.accepts[0].extra).toMatchObject({
        assetTransferMethod: 'permit2',
      });

      const free = await realFetch(`http://127.0.0.1:${port}/free`);
      expect(free.status).toBe(200);
    } finally {
      server.close();
      globalThis.fetch = realFetch;
      consoleError.mockRestore();
    }
  });
});
