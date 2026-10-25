/** Default origin for the merchant API (no path; no trailing slash). */
export const MERCHANT_API_BASE_URL = 'https://api-merchant.cryptonly.net' as const;

/** Origin for the sandbox merchant API. */
export const SANDBOX_MERCHANT_API_BASE_URL =
  'https://sandbox-api-merchant.cryptonly.net' as const;

/**
 * The facilitator URL of the public x402 discovery (Bazaar) feed, for
 * `withBazaar(new HTTPFacilitatorClient({ url: DISCOVERY_FACILITATOR_URL }))`;
 * the feed itself is at `<url>/discovery/resources`. It is on the public API
 * host, not the merchant API, and needs no key.
 */
export const DISCOVERY_FACILITATOR_URL = 'https://api.cryptonly.net/x402' as const;

/** The facilitator URL of the sandbox discovery feed. */
export const SANDBOX_DISCOVERY_FACILITATOR_URL = 'https://sandbox-api.cryptonly.net/x402' as const;

/** Header that carries the merchant (tenant) API key. */
export const MERCHANT_API_KEY_HEADER = 'x-tenant-api-key' as const;
