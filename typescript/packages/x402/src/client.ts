import { HTTPFacilitatorClient } from '@x402/core/server';
import {
  MERCHANT_API_BASE_URL,
  MERCHANT_API_KEY_HEADER,
  SANDBOX_MERCHANT_API_BASE_URL,
} from './constants.js';

/** Configuration for {@link CryptonlyFacilitatorClient}. */
export type CryptonlyFacilitatorConfig = {
  /**
   * Cryptonly API key.
   */
  apiKey: string;
  /**
   * Merchant API origin, with no path (as `baseUrl` in `@cryptonly/sdk`).
   * `/x402` is appended. Takes precedence over {@link sandbox}.
   */
  baseUrl?: string;
  /**
   * When `true`, uses the sandbox facilitator. Defaults to production.
   * Ignored when {@link baseUrl} is set.
   */
  sandbox?: boolean;
};

/**
 * Merchant API origin for a config, with no trailing slash.
 *
 * Same priority as `new Cryptonly(...)`: `baseUrl`, then `sandbox`, then
 * production.
 */
export function resolveMerchantApiOrigin(
  config: Pick<CryptonlyFacilitatorConfig, 'baseUrl' | 'sandbox'>,
): string {
  const origin =
    typeof config.baseUrl === 'string' && config.baseUrl.length > 0
      ? config.baseUrl
      : config.sandbox
        ? SANDBOX_MERCHANT_API_BASE_URL
        : MERCHANT_API_BASE_URL;
  return origin.replace(/\/+$/, '');
}

function resolveFacilitatorUrl(config: CryptonlyFacilitatorConfig): string {
  return `${resolveMerchantApiOrigin(config)}/x402`;
}

/**
 * Cryptonly facilitator client for the x402 protocol.
 *
 * Extends `HTTPFacilitatorClient` from `@x402/core/server`. The API key goes
 * on `/verify`, `/settle` and `/supported`. The discovery feed is elsewhere:
 * see `fetchDiscoveryResources` and `DISCOVERY_FACILITATOR_URL`.
 *
 * @example
 * ```ts
 * const facilitator = new CryptonlyFacilitatorClient({
 *   apiKey: process.env.CRYPTONLY_API_KEY!,
 *   sandbox: true,
 * });
 * const server = new x402ResourceServer(facilitator).register(
 *   'eip155:84532',
 *   new ExactEvmScheme(),
 * );
 * ```
 */
export class CryptonlyFacilitatorClient extends HTTPFacilitatorClient {
  constructor(config: CryptonlyFacilitatorConfig) {
    if (!config?.apiKey) {
      throw new TypeError('CryptonlyFacilitatorClient: `apiKey` is required');
    }
    const headers = { [MERCHANT_API_KEY_HEADER]: config.apiKey };
    super({
      url: resolveFacilitatorUrl(config),
      createAuthHeaders: async () => ({
        verify: headers,
        settle: headers,
        supported: headers,
      }),
    });
  }
}
