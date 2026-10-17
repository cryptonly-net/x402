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
   * When `true`, uses the sandbox facilitator. Defaults to production.
   */
  sandbox?: boolean;
};

function resolveFacilitatorUrl(config: CryptonlyFacilitatorConfig): string {
  const origin = config.sandbox
    ? SANDBOX_MERCHANT_API_BASE_URL
    : MERCHANT_API_BASE_URL;
  return `${origin}/x402`;
}

/**
 * Cryptonly facilitator client for the x402 protocol.
 *
 * Extends `HTTPFacilitatorClient` from `@x402/core/server`.
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
