import Fastify, { type FastifyInstance } from 'fastify';
import type { X402PublicUrlOptions } from '@cryptonly/x402';
import { resource, x402Config } from '../../x402/src/config.fixture.js';
import {
  FACILITATOR_BASE_URL,
  configFetchOf,
  decodeHeader,
  facilitatorFetch,
  muteBazaarImportLog,
  paymentFor,
  type FacilitatorCalls,
} from '../../x402/src/facilitator.fixture.js';
import { cryptonlyPayments } from './index.js';

const cases: {
  name: string;
  options: X402PublicUrlOptions;
  priced: string;
  route: string;
  request: string;
  resourceUrl: RegExp;
}[] = [
  {
    name: 'a proxy that strips /v1',
    options: { pathPrefix: '/v1', publicBaseUrl: 'https://api.example.com' },
    priced: '/v1/weather/:city',
    route: '/weather/:city',
    request: '/weather/lisbon?units=c',
    resourceUrl: /^https:\/\/api\.example\.com\/v1\/weather\/lisbon\?units=c$/,
  },
  {
    name: 'a proxy that adds /internal',
    options: { publicPath: (path) => path.replace(/^\/internal/, '') },
    priced: '/weather/:city',
    route: '/internal/weather/:city',
    request: '/internal/weather/lisbon',
    resourceUrl: /^http:\/\/localhost(:80)?\/weather\/lisbon$/,
  },
];

describe('cryptonlyPayments behind a proxy that rewrites paths', () => {
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

  it.each(cases)('prices and settles the public path behind $name', async (c) => {
    app = Fastify();
    await app.register(cryptonlyPayments, {
      apiKey: 'k',
      baseUrl: FACILITATOR_BASE_URL,
      fetch: configFetchOf(x402Config({ resources: [resource({ path: c.priced })] })),
      refreshIntervalMs: 0,
      ...c.options,
    });
    app.get(c.route, async (request) => ({ city: (request.params as { city: string }).city }));
    await app.ready();

    const unpaid = await app.inject({ method: 'GET', url: c.request });
    expect(unpaid.statusCode).toBe(402);
    const required = String(unpaid.headers['payment-required']);
    expect(decodeHeader(required).resource.url).toMatch(c.resourceUrl);

    const paid = await app.inject({
      method: 'GET',
      url: c.request,
      headers: { 'payment-signature': paymentFor(required) },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toEqual({ city: 'lisbon' });
    expect(paid.headers['payment-response']).toBeTruthy();
    expect(calls.settled).toHaveLength(1);
  });

  it('rejects invalid options when registered', async () => {
    app = Fastify();
    await expect(
      app.register(cryptonlyPayments, { apiKey: 'k', pathPrefix: 'v1' }).ready(),
    ).rejects.toThrow('pathPrefix must be a path');
  });
});
