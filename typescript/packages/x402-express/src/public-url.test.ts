import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
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
import { cryptonlyPaymentMiddleware } from './index.js';

type Case = {
  name: string;
  options: X402PublicUrlOptions;
  /** Path the dashboard prices (public). */
  priced: string;
  /** Route as the app serves it, behind the proxy. */
  route: string;
  request: string;
  /** `resource.url` in the 402; `{base}` is the app's own origin. */
  resourceUrl: string;
};

const cases: Case[] = [
  {
    name: 'a proxy that strips /v1',
    options: { pathPrefix: '/v1', publicBaseUrl: 'https://api.example.com' },
    priced: '/v1/weather/:city',
    route: '/weather/:city',
    request: '/weather/lisbon?units=c',
    resourceUrl: 'https://api.example.com/v1/weather/lisbon?units=c',
  },
  {
    name: 'a proxy that adds /internal',
    options: { publicPath: (path) => path.replace(/^\/internal/, '') },
    priced: '/weather/:city',
    route: '/internal/weather/:city',
    request: '/internal/weather/lisbon',
    resourceUrl: '{base}/weather/lisbon',
  },
];

describe('cryptonlyPaymentMiddleware behind a proxy that rewrites paths', () => {
  const realFetch = globalThis.fetch;
  const calls: FacilitatorCalls = { verified: [], settled: [] };
  let server: Server | undefined;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    calls.verified.length = 0;
    calls.settled.length = 0;
    consoleError = muteBazaarImportLog();
    globalThis.fetch = facilitatorFetch(calls, realFetch);
  });

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined));
    server = undefined;
    globalThis.fetch = realFetch;
    consoleError.mockRestore();
  });

  it.each(cases)('prices and settles the public path behind $name', async (c) => {
    const app = express();
    app.use(
      cryptonlyPaymentMiddleware({
        apiKey: 'k',
        baseUrl: FACILITATOR_BASE_URL,
        fetch: configFetchOf(x402Config({ resources: [resource({ path: c.priced })] })),
        refreshIntervalMs: 0,
        ...c.options,
      }),
    );
    app.get(c.route, (req, res) => res.json({ city: req.params.city }));
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const unpaid = await realFetch(`${base}${c.request}`);
    expect(unpaid.status).toBe(402);
    const required = unpaid.headers.get('payment-required')!;
    expect(decodeHeader(required).resource.url).toBe(c.resourceUrl.replace('{base}', base));

    const paid = await realFetch(`${base}${c.request}`, {
      headers: { 'payment-signature': paymentFor(required) },
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toEqual({ city: 'lisbon' });
    expect(paid.headers.get('payment-response')).toBeTruthy();
    expect(calls.settled).toHaveLength(1);
  });

  it('serves a rewritten path for free without the mapping', async () => {
    const app = express();
    app.use(
      cryptonlyPaymentMiddleware({
        apiKey: 'k',
        baseUrl: FACILITATOR_BASE_URL,
        fetch: configFetchOf(x402Config({ resources: [resource({ path: '/v1/weather/:city' })] })),
        refreshIntervalMs: 0,
      }),
    );
    app.get('/weather/:city', (req, res) => res.json({ city: req.params.city }));
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // The middleware gates only the paths it knows, so this is why the option exists.
    expect((await realFetch(`${base}/weather/lisbon`)).status).toBe(200);
  });
});
