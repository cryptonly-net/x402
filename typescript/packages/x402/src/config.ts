import type { RouteConfig } from '@x402/core/server';
import type { Network } from '@x402/core/types';
import { resolveMerchantApiOrigin, type CryptonlyFacilitatorConfig } from './client.js';
import { MERCHANT_API_KEY_HEADER } from './constants.js';

/**
 * `account.status` in `GET /x402/config`. Only `active` can be paid: x402 is
 * on for every account unless Cryptonly suspended it or production still
 * needs the business verification.
 */
export type X402AccountStatus = 'active' | 'suspended' | 'tenant_not_verified';

/** An asset the account accepts, from `GET /x402/config`. */
export type X402ConfigAsset = {
  symbol: string;
  currencyCode: string;
  /** Token contract address (EVM) or SPL mint (Solana, base58). */
  address: string;
  decimals: number;
  /**
   * Transfer methods the facilitator settles for it: `eip3009`, `permit2`
   * (EVM) or `spl` (Solana).
   */
  methods: string[];
  /** Smallest price, in atomic units. */
  minAmount: string;
  /** CAIP-2 network of the asset. Older APIs omit it: {@link X402Config.network}. */
  network?: Network;
  /** `payTo` on the asset's network. Older APIs omit it: {@link X402Config.payTo}. */
  payTo?: string | null;
  /** EVM: EIP-712 domain of the token; goes into `extra`. */
  eip712?: { name: string; version: string };
  /** Solana: the facilitator's fee payer; goes into `extra.feePayer`. */
  feePayer?: string;
};

/** A paid resource configured in the dashboard. */
export type X402ConfigResource = {
  id: string;
  /** HTTP method, or `*` for any method. */
  method: string;
  /** Full URL as entered in the dashboard; may hold `:param` segments. */
  url: string;
  /** Path of {@link url}, the route pattern (`/weather/:city`). */
  path: string;
  price: {
    /** Atomic units. */
    amount: string;
    /** Token contract address or SPL mint. */
    asset: string;
    currencyCode: string;
    /** CAIP-2 network of the asset. */
    network?: Network;
  };
  scheme: string;
  maxTimeoutSeconds: number;
  description: string | null;
  mimeType: string | null;
  /** Listed in the public discovery feed (bazaar). */
  discoverable: boolean;
  /** JSON Schema of the query (GET/HEAD/DELETE) or the JSON body. */
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
};

/** Response of `GET /x402/config`: the x402 setup of the key's account. */
export type X402Config = {
  account: { id: string; name: string; status: X402AccountStatus };
  environment: 'production' | 'sandbox';
  /** CAIP-2 network of Base, such as `eip155:84532`. */
  network: Network;
  /** `payTo` on {@link network}. `balance` (Cryptonly balance) is Base only. */
  payTo: { mode: 'wallet' | 'balance'; address: string | null };
  /** Every network the account can be paid on, with its `payTo`. */
  networks?: Array<{
    network: Network;
    payTo: { mode: 'wallet' | 'balance'; address: string | null };
  }>;
  assets: X402ConfigAsset[];
  resources: X402ConfigResource[];
  fees: Record<string, unknown>;
  limits: { dailyGasUsd: number };
};

/** Why {@link fetchX402Config} or {@link routesFromConfig} failed. */
export type X402ConfigErrorCode =
  'network_error' | 'http_error' | 'invalid_response' | 'account_not_active' | 'pay_to_missing';

/** Thrown by {@link fetchX402Config} and {@link routesFromConfig}. */
export class X402ConfigError extends Error {
  readonly code: X402ConfigErrorCode;
  /** HTTP status, for `http_error`. */
  readonly status?: number;

  constructor(
    code: X402ConfigErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'X402ConfigError';
    this.code = code;
    if (options?.status !== undefined) this.status = options.status;
  }
}

/** Options for {@link fetchX402Config}. */
export type FetchX402ConfigOptions = CryptonlyFacilitatorConfig & {
  /** `fetch` implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Request timeout. Defaults to 10 s. */
  timeoutMs?: number;
};

const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;

/**
 * Loads `GET <base>/x402/config` with the API key (scope `x402.verify`).
 *
 * @throws {X402ConfigError} `network_error`, `http_error` or `invalid_response`.
 */
export async function fetchX402Config(options: FetchX402ConfigOptions): Promise<X402Config> {
  if (!options?.apiKey) {
    throw new TypeError('fetchX402Config: `apiKey` is required');
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchX402Config: no global `fetch`; pass `fetch`');
  }
  const url = `${resolveMerchantApiOrigin(options)}/x402/config`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        [MERCHANT_API_KEY_HEADER]: options.apiKey,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new X402ConfigError(
      'network_error',
      `GET ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new X402ConfigError(
      'http_error',
      `GET ${url} answered ${response.status}${describeErrorBody(text)}`,
      { status: response.status },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new X402ConfigError('invalid_response', `GET ${url} returned non-JSON`, {
      cause,
    });
  }
  return parseX402Config(body);
}

function describeErrorBody(text: string): string {
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as { message?: unknown; code?: unknown };
    const message = Array.isArray(parsed.message) ? parsed.message.join('; ') : parsed.message;
    const parts = [parsed.code, message].filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    );
    if (parts.length > 0) return `: ${parts.join(': ')}`;
  } catch {
    // Not JSON; fall through.
  }
  return `: ${text.slice(0, 200)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks the shape of a `GET /x402/config` body.
 *
 * @throws {X402ConfigError} `invalid_response`.
 */
export function parseX402Config(body: unknown): X402Config {
  const invalid = (what: string) => new X402ConfigError('invalid_response', `x402 config: ${what}`);
  if (!isObject(body)) throw invalid('not an object');
  const { account, network, payTo, assets, resources } = body;
  if (!isObject(account) || typeof account.status !== 'string') {
    throw invalid('`account.status` missing');
  }
  if (typeof network !== 'string' || !/^[^:\s]+:\S+$/.test(network)) {
    throw invalid('`network` is not a CAIP-2 id');
  }
  if (!isObject(payTo) || !(payTo.address === null || typeof payTo.address === 'string')) {
    throw invalid('`payTo` missing');
  }
  if (!Array.isArray(assets)) throw invalid('`assets` is not an array');
  if (!Array.isArray(resources)) throw invalid('`resources` is not an array');
  for (const resource of resources) {
    if (
      !isObject(resource) ||
      typeof resource.method !== 'string' ||
      typeof resource.path !== 'string' ||
      !isObject(resource.price) ||
      typeof resource.price.amount !== 'string' ||
      typeof resource.price.asset !== 'string' ||
      typeof resource.scheme !== 'string'
    ) {
      throw invalid('a resource lacks `method`, `path`, `price` or `scheme`');
    }
  }
  return body as unknown as X402Config;
}

/**
 * The parts of `@x402/extensions` that {@link routesFromConfig} uses.
 * Typed structurally so that the package stays optional.
 */
export type X402ExtensionsModule = {
  declareDiscoveryExtension(config: {
    inputSchema?: Record<string, unknown>;
    bodyType?: 'json';
  }): Record<string, unknown>;
  declareEip2612GasSponsoringExtension?(): Record<string, unknown>;
};

let extensionsModule: X402ExtensionsModule | null | undefined;

/** `@x402/extensions` when installed, else `null`. */
export function loadX402Extensions(): X402ExtensionsModule | null {
  if (extensionsModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      extensionsModule = require('@x402/extensions') as X402ExtensionsModule;
    } catch {
      extensionsModule = null;
    }
  }
  return extensionsModule;
}

/** Options for {@link routesFromConfig}. */
export type RoutesFromConfigOptions = {
  /**
   * Schemes the resource server has registered. Resources with another
   * scheme are skipped (a 402 for them could not be verified). Default: all.
   */
  schemes?: readonly string[];
  /**
   * `@x402/extensions`, for the bazaar discovery and EIP-2612 extensions.
   * Default: loaded when installed. `null` leaves extensions out.
   */
  extensions?: X402ExtensionsModule | null;
  /** Called for each resource left out, with the reason. */
  onSkip?: (resource: X402ConfigResource, reason: string) => void;
};

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** Route key of a resource: `METHOD /path`, or just `/path` for method `*`. */
export function routeKey(resource: Pick<X402ConfigResource, 'method' | 'path'>): string {
  const method = resource.method.trim().toUpperCase();
  return method === '*' || method === '' ? resource.path : `${method} ${resource.path}`;
}

/**
 * Fits a dashboard resource's declaration (`{ bazaar: { info, schema } }`) to
 * what the dashboard knows: the method and schemas, but no example values.
 *
 * - `declareDiscoveryExtension` puts an empty `queryParams` or `body` example
 *   in `info`, which fails the merchant's schema when it requires fields, so
 *   the example goes and the body stops being required.
 * - It also drops `output` unless an example is given, so the output schema
 *   is added here, under `output.example` as the package declares it.
 */
function withDashboardSchemas(
  method: string,
  declared: Record<string, unknown>,
  outputSchema: Record<string, unknown> | null,
): Record<string, unknown> {
  const bazaar = declared.bazaar as
    | {
        info?: { input?: Record<string, unknown>; output?: unknown };
        schema?: {
          properties?: {
            input?: { required?: string[] };
            output?: unknown;
          };
        };
      }
    | undefined;
  const input = bazaar?.info?.input;
  const properties = bazaar?.schema?.properties;
  if (!bazaar?.info || !input || !properties) return declared;
  // Known here; the bazaar server extension would add it per request.
  input.method = method;
  delete input.queryParams;
  delete input.body;
  if (properties.input?.required) {
    properties.input.required = properties.input.required.filter((key) => key !== 'body');
  }
  if (outputSchema) {
    bazaar.info.output = { type: 'json' };
    properties.output = {
      type: 'object',
      properties: {
        type: { type: 'string' },
        example: { type: 'object', ...outputSchema },
      },
      required: ['type'],
    };
  }
  return declared;
}

/** Solana CAIP-2 networks (`solana:<genesis>`). */
export function isSolanaNetwork(network: string): boolean {
  return network.startsWith('solana:');
}

/** EVM addresses compare case-insensitively; base58 never does. */
function sameAsset(network: string, a: string, b: string): boolean {
  return isSolanaNetwork(network) ? a === b : a.toLowerCase() === b.toLowerCase();
}

/**
 * Throws unless payments to this account can settle: the account is
 * `active` and has a `payTo` address on at least one network.
 *
 * @throws {X402ConfigError} `account_not_active` or `pay_to_missing`.
 */
export function assertPayableConfig(config: X402Config): void {
  if (config.account.status !== 'active') {
    throw new X402ConfigError(
      'account_not_active',
      `x402 account "${config.account.name}" is ${config.account.status}; ` +
        'see Settings › General in the dashboard',
    );
  }
  const payable =
    config.payTo.address || (config.networks ?? []).some((network) => network.payTo.address);
  if (!payable) {
    throw new X402ConfigError(
      'pay_to_missing',
      `x402 account "${config.account.name}" has no payTo address; ` +
        'set a payout wallet in the dashboard',
    );
  }
}

/**
 * Builds stock `@x402/core` routes (for `paymentMiddleware` and
 * `x402HTTPResourceServer`) from the dashboard configuration.
 *
 * Fails closed: an account that cannot be paid throws instead of yielding
 * no routes, since no routes would serve paid endpoints for free.
 *
 * @throws {X402ConfigError} `account_not_active` or `pay_to_missing`.
 */
export function routesFromConfig(
  config: X402Config,
  options: RoutesFromConfigOptions = {},
): Record<string, RouteConfig> {
  assertPayableConfig(config);
  const extensions = options.extensions === undefined ? loadX402Extensions() : options.extensions;
  const skip = (resource: X402ConfigResource, reason: string) => options.onSkip?.(resource, reason);

  const routes: Record<string, RouteConfig> = {};
  for (const resource of config.resources) {
    if (options.schemes && !options.schemes.includes(resource.scheme)) {
      skip(resource, `scheme "${resource.scheme}" is not registered`);
      continue;
    }
    const network = resource.price.network ?? config.network;
    const asset = config.assets.find(
      (candidate) =>
        (candidate.network ?? config.network) === network &&
        sameAsset(network, candidate.address, resource.price.asset),
    );
    if (!asset) {
      skip(resource, `asset ${resource.price.asset} is not accepted`);
      continue;
    }
    const payTo = asset.network ? asset.payTo : config.payTo.address;
    if (!payTo) {
      skip(resource, `no payTo on ${network}; set one in the dashboard`);
      continue;
    }
    const key = routeKey(resource);
    if (routes[key]) {
      skip(resource, `duplicate route "${key}"`);
      continue;
    }

    const permit2Only = asset.methods.includes('permit2') && !asset.methods.includes('eip3009');
    const method = resource.method.trim().toUpperCase();

    const routeExtensions: Record<string, unknown> = {};
    if (permit2Only && extensions?.declareEip2612GasSponsoringExtension) {
      // A buyer without a Permit2 approval signs an EIP-2612 permit too.
      Object.assign(routeExtensions, extensions.declareEip2612GasSponsoringExtension());
    }
    if (resource.discoverable && extensions) {
      Object.assign(
        routeExtensions,
        withDashboardSchemas(
          method,
          extensions.declareDiscoveryExtension({
            ...(resource.inputSchema ? { inputSchema: resource.inputSchema } : {}),
            ...(BODY_METHODS.has(method) ? { bodyType: 'json' as const } : {}),
          }),
          resource.outputSchema,
        ),
      );
    }

    routes[key] = {
      accepts: {
        scheme: resource.scheme,
        network: network as Network,
        payTo,
        price: {
          asset: resource.price.asset,
          amount: resource.price.amount,
          extra: isSolanaNetwork(network)
            ? { ...(asset.feePayer ? { feePayer: asset.feePayer } : {}) }
            : {
                name: asset.eip712?.name,
                version: asset.eip712?.version,
                ...(permit2Only ? { assetTransferMethod: 'permit2' } : {}),
              },
        },
        maxTimeoutSeconds: resource.maxTimeoutSeconds,
      },
      ...(resource.description ? { description: resource.description } : {}),
      ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
      ...(resource.discoverable && config.account.name ? { serviceName: config.account.name } : {}),
      ...(Object.keys(routeExtensions).length > 0 ? { extensions: routeExtensions } : {}),
    };
  }
  return routes;
}
