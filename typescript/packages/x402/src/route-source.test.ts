import type { RoutesConfig } from '@x402/core/server';
import type { X402Config } from './config.js';
import { MERCHANT_API_KEY_HEADER } from './constants.js';
import { BASE_SEPOLIA, resource, x402Config } from './config.fixture.js';
import { createX402RouteSource, type X402RouteSource } from './route-source.js';

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

const priced = (amount: string) =>
  x402Config({
    resources: [
      resource({
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

function amountOf(routes: RoutesConfig | undefined): string | undefined {
  const route = (routes as Record<string, { accepts: { price: { amount: string } }[] }>)?.[
    'GET /weather'
  ];
  return route?.accepts[0].price.amount;
}

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('createX402RouteSource', () => {
  let source: X402RouteSource<RoutesConfig> | undefined;
  afterEach(() => {
    source?.close();
    source = undefined;
    jest.useRealTimers();
  });

  function create(
    fetchMock: ReturnType<typeof configFetch>,
    options: { retryAfterMs?: number; refreshIntervalMs?: number } = {},
    build = jest.fn((routes: RoutesConfig, _config?: X402Config) => routes),
  ) {
    source = createX402RouteSource(
      {
        apiKey: 'key-1',
        baseUrl: 'http://api.test',
        fetch: fetchMock as unknown as typeof fetch,
        logger: silentLogger,
        ...options,
      },
      build,
    );
    return { source, build };
  }

  it('loads the config once, with the API key, and builds its routes', async () => {
    const fetchMock = configFetch(ok(priced('1000')));
    const { source, build } = create(fetchMock);

    await Promise.all([source.ready(), source.ready()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/x402/config');
    expect((init?.headers as Record<string, string>)[MERCHANT_API_KEY_HEADER]).toBe(
      'key-1',
    );
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0][1]).toMatchObject({ network: 'eip155:84532' });
    expect(source.schemes.map((s) => s.scheme)).toEqual(['exact']);
    expect(amountOf(source.current()?.value)).toBe('1000');
  });

  it('builds again only when the routes change', async () => {
    const fetchMock = configFetch(
      ok(priced('1000')),
      ok(priced('1000')),
      ok(priced('2500')),
    );
    const { source, build } = create(fetchMock);

    await source.ready();
    await expect(source.refresh()).resolves.toBe(false);
    expect(build).toHaveBeenCalledTimes(1);

    await expect(source.refresh()).resolves.toBe(true);
    expect(build).toHaveBeenCalledTimes(2);
    expect(amountOf(source.current()?.routes)).toBe('2500');
  });

  it('keeps the last good routes when a refresh fails', async () => {
    const fetchMock = configFetch(
      ok(priced('1000')),
      { status: 500, body: { message: 'boom' } },
      new Error('ECONNRESET'),
      ok(x402Config({ account: { ...x402Config().account, status: 'suspended' } })),
      ok(
        x402Config({
          payTo: { mode: 'wallet', address: null },
          networks: [{ network: 'eip155:84532', payTo: { mode: 'wallet', address: null } }],
        }),
      ),
    );
    const { source, build } = create(fetchMock);

    await source.ready();
    await expect(source.refresh()).rejects.toMatchObject({
      code: 'http_error',
    });
    await expect(source.refresh()).rejects.toMatchObject({
      code: 'network_error',
    });
    await expect(source.refresh()).rejects.toMatchObject({
      code: 'account_not_active',
    });
    await expect(source.refresh()).rejects.toMatchObject({
      code: 'pay_to_missing',
    });

    expect(build).toHaveBeenCalledTimes(1);
    expect(amountOf(source.current()?.value)).toBe('1000');
  });

  it('keeps the last good routes when build throws', async () => {
    const fetchMock = configFetch(ok(priced('1000')), ok(priced('2000')));
    const build = jest.fn((routes: RoutesConfig, _config?: X402Config) => routes);
    build.mockImplementationOnce((routes) => routes);
    build.mockImplementationOnce(() => {
      throw new Error('RouteConfigurationError');
    });
    const { source } = create(fetchMock, {}, build);

    await source.ready();
    await expect(source.refresh()).rejects.toThrow('RouteConfigurationError');
    expect(amountOf(source.current()?.value)).toBe('1000');
  });

  it('rejects ready() until a first load succeeds', async () => {
    const fetchMock = configFetch(
      { status: 401, body: { message: 'invalid key' } },
      ok(priced('1000')),
    );
    const { source, build } = create(fetchMock, { retryAfterMs: 0 });

    await expect(source.ready()).rejects.toMatchObject({ code: 'http_error' });
    expect(source.current()).toBeUndefined();
    expect(build).not.toHaveBeenCalled();

    await source.ready();
    expect(source.current()).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed first load within retryAfterMs', async () => {
    const fetchMock = configFetch(new Error('ECONNREFUSED'));
    const { source } = create(fetchMock, { retryAfterMs: 60_000 });
    await expect(source.ready()).rejects.toThrow();
    await expect(source.ready()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(source.retryAfterMs).toBe(60_000);
  });

  it('refreshes on an interval and stops on close()', async () => {
    jest.useFakeTimers();
    const fetchMock = configFetch(ok(priced('1000')), ok(priced('3000')));
    const { source } = create(fetchMock, { refreshIntervalMs: 60_000 });

    await source.ready();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(amountOf(source.current()?.routes)).toBe('3000');

    source.close();
    await jest.advanceTimersByTimeAsync(180_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
