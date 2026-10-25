import { validateDiscoveryExtension, withBazaar } from '@x402/extensions/bazaar';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { CryptonlyFacilitatorClient } from './client.js';
import {
  X402ConfigError,
  fetchX402Config,
  routeKey,
  routesFromConfig,
  type X402ConfigResource,
} from './config.js';
import { fetchDiscoveryResources } from './bazaar.js';
import { DISCOVERY_FACILITATOR_URL, MERCHANT_API_KEY_HEADER } from './constants.js';
import {
  BASE_SEPOLIA,
  PAY_TO,
  PERMIT2_TOKEN,
  USDC,
  resource,
  x402Config,
} from './config.fixture.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('routesFromConfig', () => {
  it('maps a resource to a stock route with the price in atomic units', () => {
    const routes = routesFromConfig(x402Config(), { extensions: null });
    expect(routes).toEqual({
      'GET /weather': {
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:84532',
            payTo: PAY_TO,
            price: {
              asset: USDC,
              amount: '1000',
              extra: { name: 'USDC', version: '2' },
            },
            maxTimeoutSeconds: 300,
          },
        ],
        description: 'Current weather',
        mimeType: 'application/json',
        serviceName: 'Weather API',
        iconUrl: 'https://cdn.example.com/icon.png',
      },
    });
  });

  it('puts the tags on the route, and no service metadata the account lacks', () => {
    const routes = routesFromConfig(
      x402Config({
        account: { ...x402Config().account, serviceName: null, iconUrl: null },
        resources: [resource({ tags: ['weather', 'forecast'] })],
      }),
      { extensions: null },
    );
    expect(routes['GET /weather'].tags).toEqual(['weather', 'forecast']);
    expect(routes['GET /weather']).not.toHaveProperty('serviceName');
    expect(routes['GET /weather']).not.toHaveProperty('iconUrl');
  });

  it('marks a Permit2-only asset and adds EIP-2612 gas sponsoring', () => {
    const routes = routesFromConfig(
      x402Config({
        resources: [
          resource({
            path: '/report',
            prices: [
              { amount: '5', asset: PERMIT2_TOKEN, currencyCode: 'TKN_BASE', network: BASE_SEPOLIA },
            ],
          }),
        ],
      }),
    );
    const route = routes['GET /report'];
    expect(route.accepts).toMatchObject([
      {
        price: {
          asset: PERMIT2_TOKEN,
          amount: '5',
          extra: {
            name: 'Token',
            version: '1',
            assetTransferMethod: 'permit2',
          },
        },
      },
    ]);
    expect(Object.keys(route.extensions ?? {})).toEqual(['eip2612GasSponsoring']);
  });

  it('declares the bazaar discovery extension for discoverable resources', () => {
    const inputSchema = {
      properties: { units: { type: 'string', enum: ['c', 'f'] } },
    };
    const outputSchema = { properties: { temperatureC: { type: 'number' } } };
    const routes = routesFromConfig(
      x402Config({
        resources: [
          resource({ discoverable: true, inputSchema, outputSchema }),
          resource({
            method: 'POST',
            path: '/forecast',
            discoverable: true,
            inputSchema,
          }),
          resource({ path: '/private' }),
        ],
      }),
    );

    const bazaar = routes['GET /weather'].extensions?.bazaar as {
      info: { input: Record<string, unknown> };
      schema: {
        properties: { input: { properties: Record<string, unknown> } };
      };
    };
    expect(bazaar.info.input).toMatchObject({ type: 'http' });
    expect(bazaar.schema.properties.input.properties.queryParams).toMatchObject(inputSchema);

    const post = routes['POST /forecast'].extensions?.bazaar as {
      info: { input: Record<string, unknown> };
    };
    expect(post.info.input).toMatchObject({ type: 'http', bodyType: 'json' });

    expect(routes['GET /private'].extensions).toBeUndefined();
    // Service metadata describes the service, listed or not.
    expect(routes['GET /private'].serviceName).toBe('Weather API');
  });

  it('publishes dashboard schemas so the declaration validates against itself', () => {
    const inputSchema = {
      properties: { units: { type: 'string', enum: ['c', 'f'] } },
      required: ['units'],
    };
    const outputSchema = {
      properties: { temperatureC: { type: 'number' } },
      required: ['temperatureC'],
    };
    const routes = routesFromConfig(
      x402Config({
        resources: [
          resource({ discoverable: true, inputSchema, outputSchema }),
          resource({
            method: 'POST',
            path: '/forecast',
            discoverable: true,
            inputSchema,
          }),
        ],
      }),
    );

    const get = routes['GET /weather'].extensions?.bazaar as Record<string, any>;
    expect(get.info.output).toEqual({ type: 'json' });
    expect(get.schema.properties.output.properties.example).toMatchObject(outputSchema);
    expect(get.info.input).not.toHaveProperty('queryParams');
    expect(validateDiscoveryExtension(get as never)).toEqual({ valid: true });

    const post = routes['POST /forecast'].extensions?.bazaar as Record<string, any>;
    expect(post.schema.properties.input.properties.body).toMatchObject(inputSchema);
    expect(post.info.input).not.toHaveProperty('body');
    expect(validateDiscoveryExtension(post as never)).toEqual({ valid: true });
  });

  it('declares discovery without @x402/extensions, leaving EIP-2612 out', () => {
    const routes = routesFromConfig(
      x402Config({
        resources: [
          resource({
            discoverable: true,
            prices: [
              { amount: '5', asset: PERMIT2_TOKEN, currencyCode: 'TKN_BASE', network: BASE_SEPOLIA },
            ],
          }),
        ],
      }),
      { extensions: null },
    );
    expect(Object.keys(routes['GET /weather'].extensions ?? {})).toEqual(['bazaar']);
  });

  it('declares no discovery for method `*`, which bazaar cannot describe', () => {
    const routes = routesFromConfig(
      x402Config({ resources: [resource({ method: '*', discoverable: true })] }),
      { extensions: null },
    );
    expect(routes['/weather'].extensions).toBeUndefined();
  });

  it('uses the bare path as the key for method `*`', () => {
    expect(routeKey({ method: '*', path: '/any' })).toBe('/any');
    expect(routeKey({ method: 'get', path: '/a' })).toBe('GET /a');
    const routes = routesFromConfig(
      x402Config({
        resources: [resource({ method: '*', path: '/weather/:city' })],
      }),
      { extensions: null },
    );
    expect(Object.keys(routes)).toEqual(['/weather/:city']);
  });

  it('throws when the account has no payTo address', () => {
    const payTo = { mode: 'balance' as const, address: null };
    const config = x402Config({
      payTo,
      networks: [{ network: 'eip155:84532', payTo }],
    });
    expect(() => routesFromConfig(config)).toThrow(X402ConfigError);
    expect(() => routesFromConfig(config)).toThrow(
      expect.objectContaining({ code: 'pay_to_missing' }),
    );
  });

  it('throws when the account is not active', () => {
    const config = x402Config({
      account: { ...x402Config().account, status: 'suspended' },
    });
    expect(() => routesFromConfig(config)).toThrow(
      expect.objectContaining({ code: 'account_not_active' }),
    );
  });

  it('skips unregistered schemes, unknown assets and duplicates', () => {
    const skipped: Array<[X402ConfigResource, string]> = [];
    const routes = routesFromConfig(
      x402Config({
        resources: [
          resource(),
          resource({ id: 'upto', path: '/stream', scheme: 'upto' }),
          resource({
            id: 'gone',
            path: '/gone',
            prices: [{ amount: '1', asset: '0xdead', currencyCode: 'X', network: BASE_SEPOLIA }],
          }),
          resource({ id: 'dup' }),
        ],
      }),
      {
        schemes: ['exact'],
        extensions: null,
        onSkip: (skippedResource, reason) => skipped.push([skippedResource, reason]),
      },
    );
    expect(Object.keys(routes)).toEqual(['GET /weather']);
    expect(skipped.map(([r, reason]) => [r.id, reason])).toEqual([
      ['upto', 'scheme "upto" is not registered'],
      ['gone', 'X: asset 0xdead is not accepted'],
      ['dup', 'duplicate route "GET /weather"'],
    ]);
  });
});

describe('fetchX402Config', () => {
  it('sends the api key to <base>/x402/config and parses the body', async () => {
    const config = x402Config();
    const fetchMock = jest.fn(async () => jsonResponse(config));
    const result = await fetchX402Config({
      apiKey: 'key-1',
      baseUrl: 'http://localhost:8000/',
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(result).toEqual(config);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:8000/x402/config');
    expect((init.headers as Record<string, string>)[MERCHANT_API_KEY_HEADER]).toBe('key-1');
  });

  it('throws http_error with the status and the API message', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ code: 'insufficient_scope', message: 'needs x402.verify' }, 403),
    );
    await expect(
      fetchX402Config({
        apiKey: 'k',
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: 'X402ConfigError',
      code: 'http_error',
      status: 403,
      message: expect.stringContaining('insufficient_scope: needs x402.verify'),
    });
  });

  it.each([
    ['no prices', { prices: [] }],
    [
      'a price without an asset',
      { prices: [{ amount: '1', currencyCode: 'USDC_BASE', network: 'eip155:84532' }] },
    ],
  ])('throws invalid_response for a resource with %s', async (_name, patch) => {
    const body = { ...x402Config(), resources: [{ ...resource(), ...patch }] };
    const fetchMock = jest.fn(async () => jsonResponse(body));
    await expect(
      fetchX402Config({
        apiKey: 'k',
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('throws invalid_response for a malformed body', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ account: {} }));
    await expect(
      fetchX402Config({
        apiKey: 'k',
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('throws network_error when fetch rejects', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      fetchX402Config({
        apiKey: 'k',
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'network_error' });
  });
});

describe('withBazaar on the discovery feed', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('lists discovery resources from the public feed, without a key', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ x402Version: 2, items: [], pagination: { limit: 20, offset: 0, total: 0 } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = withBazaar(new HTTPFacilitatorClient({ url: DISCOVERY_FACILITATOR_URL }));
    await client.extensions.bazaar.listResources();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cryptonly.net/x402/discovery/resources');
    expect((init.headers as Record<string, string>)[MERCHANT_API_KEY_HEADER]).toBeUndefined();
  });
});

describe('fetchDiscoveryResources', () => {
  it('reads the sandbox feed with the filters given', async () => {
    const body = { x402Version: 2, items: [], pagination: { limit: 5, offset: 0, total: 0 } };
    const fetchMock = jest.fn(async () => jsonResponse(body));
    await expect(
      fetchDiscoveryResources({
        sandbox: true,
        network: 'eip155:84532',
        extensions: ['bazaar'],
        limit: 5,
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toEqual(body);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      'https://sandbox-api.cryptonly.net/x402/discovery/resources' +
        '?type=http&network=eip155%3A84532&extensions=bazaar&limit=5',
    );
  });

  it('throws on an error status', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({}, 503));
    await expect(
      fetchDiscoveryResources({ fetch: fetchMock as unknown as typeof fetch }),
    ).rejects.toThrow(/answered 503/);
  });
});

describe('routesFromConfig on Solana', () => {
  const SOLANA = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
  const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const SOL_PAY_TO = '4Htxvg4qYuYFBVwG9VMywRJGKGzECgBF1ShGUuXxtsid';
  const FEE_PAYER = '7P6XktW1QSA9g7VN2pr77LPP5DVGf9qkwad41cxP81Tk';
  const solanaAsset = (payTo: string | null = SOL_PAY_TO) => ({
    symbol: 'USDC',
    currencyCode: 'USDC_SOL',
    address: MINT,
    decimals: 6,
    methods: ['spl'],
    minAmount: '1000',
    network: SOLANA as `${string}:${string}`,
    payTo,
    feePayer: FEE_PAYER,
  });
  const solanaPrice = {
    amount: '10000',
    asset: MINT,
    currencyCode: 'USDC_SOL',
    network: SOLANA as `${string}:${string}`,
  };
  const solanaResource = resource({
    path: '/weather/solana',
    prices: [solanaPrice],
  });

  it('prices a Solana resource on its network, payTo and fee payer', () => {
    const config = x402Config({
      assets: [...x402Config().assets, solanaAsset()],
      resources: [resource(), solanaResource],
    });
    const routes = routesFromConfig(config, { extensions: null });
    expect(routes['GET /weather/solana']).toEqual(
      expect.objectContaining({
        accepts: [
          expect.objectContaining({
            network: SOLANA,
            payTo: SOL_PAY_TO,
            price: {
              asset: MINT,
              amount: '10000',
              extra: { feePayer: FEE_PAYER },
            },
          }),
        ],
      }),
    );
    // Base routes keep the Base payTo and EIP-712 extra.
    expect(routes['GET /weather']).toEqual(
      expect.objectContaining({
        accepts: [
          expect.objectContaining({
            network: 'eip155:84532',
            payTo: PAY_TO,
          }),
        ],
      }),
    );
  });

  it('matches mints case-sensitively', () => {
    const config = x402Config({
      assets: [solanaAsset()],
      resources: [
        resource({
          path: '/x',
          prices: [{ ...solanaPrice, asset: MINT.toLowerCase() }],
        }),
      ],
    });
    const onSkip = jest.fn();
    expect(routesFromConfig(config, { extensions: null, onSkip })).toEqual({});
    expect(onSkip).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/not accepted/));
  });

  it('skips a Solana resource without a Solana payTo, keeps Base', () => {
    const config = x402Config({
      assets: [...x402Config().assets, solanaAsset(null)],
      resources: [resource(), solanaResource],
    });
    const onSkip = jest.fn();
    const routes = routesFromConfig(config, { extensions: null, onSkip });
    expect(Object.keys(routes)).toEqual(['GET /weather']);
    expect(onSkip).toHaveBeenCalledWith(solanaResource, expect.stringMatching(/no payTo/));
  });

  it('is payable with only a Solana payTo', () => {
    const config = x402Config({
      payTo: { mode: 'wallet', address: null },
      networks: [
        { network: 'eip155:84532', payTo: { mode: 'wallet', address: null } },
        {
          network: SOLANA as `${string}:${string}`,
          payTo: { mode: 'wallet', address: SOL_PAY_TO },
        },
      ],
      assets: [solanaAsset()],
      resources: [solanaResource],
    });
    expect(Object.keys(routesFromConfig(config, { extensions: null }))).toEqual([
      'GET /weather/solana',
    ]);
  });
});

describe('routesFromConfig with several prices', () => {
  const SOLANA = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as `${string}:${string}`;
  const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const SOL_PAY_TO = '4Htxvg4qYuYFBVwG9VMywRJGKGzECgBF1ShGUuXxtsid';
  const solanaAsset = (payTo: string | null = SOL_PAY_TO) => ({
    symbol: 'USDC',
    currencyCode: 'USDC_SOL',
    address: MINT,
    decimals: 6,
    methods: ['spl'],
    minAmount: '1000',
    network: SOLANA,
    payTo,
    feePayer: 'FeePayer1111',
  });
  const prices = [
    { amount: '20000', asset: MINT, currencyCode: 'USDC_SOL', network: SOLANA },
    { amount: '10000', asset: USDC, currencyCode: 'USDC_BASE', network: BASE_SEPOLIA },
    { amount: '5', asset: PERMIT2_TOKEN, currencyCode: 'TKN_BASE', network: BASE_SEPOLIA },
  ];

  it('accepts each price on its own network, in order', () => {
    const routes = routesFromConfig(
      x402Config({
        assets: [...x402Config().assets, solanaAsset()],
        resources: [resource({ prices })],
      }),
    );
    const route = routes['GET /weather'];
    expect(route.accepts).toEqual([
      expect.objectContaining({
        network: SOLANA,
        payTo: SOL_PAY_TO,
        price: {
          asset: MINT,
          amount: '20000',
          extra: { feePayer: 'FeePayer1111' },
        },
      }),
      expect.objectContaining({
        network: 'eip155:84532',
        payTo: PAY_TO,
        price: {
          asset: USDC,
          amount: '10000',
          extra: { name: 'USDC', version: '2' },
        },
      }),
      expect.objectContaining({
        price: {
          asset: PERMIT2_TOKEN,
          amount: '5',
          extra: {
            name: 'Token',
            version: '1',
            assetTransferMethod: 'permit2',
          },
        },
      }),
    ]);
    // One Permit2-only option is enough for the route to sponsor EIP-2612.
    expect(Object.keys(route.extensions ?? {})).toEqual(['eip2612GasSponsoring']);
  });

  it('leaves out only the prices the account cannot be paid in', () => {
    const skipped: string[] = [];
    const routes = routesFromConfig(
      x402Config({
        assets: [...x402Config().assets, solanaAsset(null)],
        resources: [
          resource({
            prices: [
              ...prices,
              { amount: '1', asset: '0xdead', currencyCode: 'GONE', network: BASE_SEPOLIA },
            ],
          }),
        ],
      }),
      { extensions: null, onSkip: (_resource, reason) => skipped.push(reason) },
    );
    expect(routes['GET /weather'].accepts).toEqual([
      expect.objectContaining({
        price: expect.objectContaining({ asset: USDC }),
      }),
      expect.objectContaining({
        price: expect.objectContaining({ asset: PERMIT2_TOKEN }),
      }),
    ]);
    expect(skipped).toEqual([
      expect.stringMatching(/^USDC_SOL: no payTo on solana:/),
      'GONE: asset 0xdead is not accepted',
    ]);
  });
});
