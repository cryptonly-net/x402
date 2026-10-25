import {
  checkIfBazaarNeeded,
  type RoutesConfig,
  type x402ResourceServer,
} from '@x402/core/server';
import type { PaymentRequirements } from '@x402/core/types';
import { DISCOVERY_FACILITATOR_URL, SANDBOX_DISCOVERY_FACILITATOR_URL } from './constants.js';
import { optionalModule } from './optional.js';

const QUERY_METHODS = ['GET', 'HEAD', 'DELETE'];
const BODY_METHODS = ['POST', 'PUT', 'PATCH'];
const BODY_TYPES = ['json', 'form-data', 'text'];
const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

/**
 * The bazaar discovery extension (`{ bazaar: { info, schema } }`) of a
 * dashboard resource, in the shape `declareDiscoveryExtension` produces: `info`
 * describes the call and `schema` holds the JSON Schemas, the input as the
 * query parameters (GET, HEAD, DELETE) or the JSON body (POST, PUT, PATCH),
 * and the output under `output.example`. The dashboard has no example values,
 * so `info` carries none and the body is not required, which keeps `info`
 * valid against `schema` whatever the merchant's schema requires.
 *
 * `null` for a method bazaar cannot describe (`*`). The bazaar server
 * extension adds `routeTemplate` and `pathParams` per request.
 */
export function dashboardDiscoveryExtension(resource: {
  method: string;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
}): { bazaar: Record<string, unknown> } | null {
  const method = resource.method.trim().toUpperCase();
  const body = BODY_METHODS.includes(method);
  if (!body && !QUERY_METHODS.includes(method)) return null;
  const inputSchema = resource.inputSchema ?? { properties: {} };
  return {
    bazaar: {
      info: {
        input: body ? { type: 'http', method, bodyType: 'json' } : { type: 'http', method },
        ...(resource.outputSchema ? { output: { type: 'json' } } : {}),
      },
      schema: {
        $schema: JSON_SCHEMA_DRAFT,
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'http' },
              method: { type: 'string', enum: body ? BODY_METHODS : QUERY_METHODS },
              ...(body
                ? { bodyType: { type: 'string', enum: BODY_TYPES }, body: inputSchema }
                : { queryParams: { type: 'object', ...inputSchema } }),
            },
            required: body ? ['type', 'method', 'bodyType'] : ['type', 'method'],
            additionalProperties: false,
          },
          ...(resource.outputSchema
            ? {
                output: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    example: { type: 'object', ...resource.outputSchema },
                  },
                  required: ['type'],
                },
              }
            : {}),
        },
        required: ['input'],
      },
    },
  };
}

type BazaarModule = {
  bazaarResourceServerExtension: Parameters<x402ResourceServer['registerExtension']>[0];
  validateBazaarRouteExtensions(routes: RoutesConfig): void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadBazaar = optionalModule<BazaarModule>(() => require('@x402/extensions/bazaar'));

/**
 * Registers the bazaar server extension on `resourceServer` when `routes`
 * declare discovery, and checks the declarations. Synchronous, so the first
 * 402 is already enriched (method, `routeTemplate`, `pathParams`); the stock
 * middleware then finds it registered. A no-op without `@x402/extensions`.
 */
export function registerBazaar(resourceServer: x402ResourceServer, routes: RoutesConfig): void {
  if (!checkIfBazaarNeeded(routes)) return;
  const bazaar = loadBazaar();
  if (!bazaar) return;
  if (!resourceServer.hasExtension('bazaar')) {
    resourceServer.registerExtension(bazaar.bazaarResourceServerExtension);
  }
  bazaar.validateBazaarRouteExtensions(routes);
}

/** A resource in the Cryptonly discovery feed (x402 v2 `DiscoveryResource`). */
export type CryptonlyDiscoveryResource = {
  resource: string;
  type: 'http';
  x402Version: number;
  accepts: PaymentRequirements[];
  /** ISO 8601. */
  lastUpdated: string;
  description?: string;
  mimeType?: string;
  /** The merchant account's listing name. */
  serviceName?: string;
  tags?: string[];
  /** The merchant account's logo, square. */
  iconUrl?: string;
  extensions: {
    bazaar: Record<string, unknown>;
    /** `verifiedMerchant`: the seller passed Cryptonly's business verification. */
    cryptonly: { verifiedMerchant: boolean };
  };
};

/** Response of the discovery feed (x402 v2 `DiscoveryResourcesResponse`). */
export type CryptonlyDiscoveryResponse = {
  x402Version: number;
  items: CryptonlyDiscoveryResource[];
  pagination: { limit: number; offset: number; total: number };
};

/** Filters and options for {@link fetchDiscoveryResources}. */
export type FetchDiscoveryResourcesOptions = {
  /** Only resources paying to this address. */
  payTo?: string;
  /** CAIP-2, such as `eip155:8453`. */
  network?: string;
  scheme?: string;
  /** Extension keys every item must carry, such as `bazaar`. */
  extensions?: string[];
  /** 1 to 100; default 20. */
  limit?: number;
  offset?: number;
  /** Read the sandbox feed. */
  sandbox?: boolean;
  /** `fetch` implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
};

/**
 * Lists paid resources from the public Cryptonly discovery feed
 * (`GET https://api.cryptonly.net/x402/discovery/resources`). It needs no
 * key. Stock clients read it too, with
 * `withBazaar(new HTTPFacilitatorClient({ url: DISCOVERY_FACILITATOR_URL }))`.
 */
export async function fetchDiscoveryResources(
  options: FetchDiscoveryResourcesOptions = {},
): Promise<CryptonlyDiscoveryResponse> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchDiscoveryResources: no global `fetch`; pass `fetch`');
  }
  const query = new URLSearchParams({ type: 'http' });
  for (const key of ['payTo', 'network', 'scheme'] as const) {
    const value = options[key];
    if (value) query.set(key, value);
  }
  if (options.extensions?.length) query.set('extensions', options.extensions.join(','));
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.offset !== undefined) query.set('offset', String(options.offset));
  const base = options.sandbox ? SANDBOX_DISCOVERY_FACILITATOR_URL : DISCOVERY_FACILITATOR_URL;
  const url = `${base}/discovery/resources?${query}`;
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`GET ${url} answered ${response.status}`);
  }
  return (await response.json()) as CryptonlyDiscoveryResponse;
}
