/** Default origin for the merchant API (no path; no trailing slash). */
export const MERCHANT_API_BASE_URL = 'https://api-merchant.cryptonly.net' as const;

/** Origin for the sandbox merchant API. */
export const SANDBOX_MERCHANT_API_BASE_URL =
  'https://sandbox-api-merchant.cryptonly.net' as const;

/**
 * The public x402 discovery (Bazaar) feed, as a facilitator URL for
 * `withBazaar(new HTTPFacilitatorClient({ url: DISCOVERY_FEED_URL }))`. It is
 * on the public API host, not the merchant API, and needs no key.
 */
export const DISCOVERY_FEED_URL = 'https://api.cryptonly.net/x402' as const;

/** The sandbox discovery feed. */
export const SANDBOX_DISCOVERY_FEED_URL = 'https://sandbox-api.cryptonly.net/x402' as const;

/** Header that carries the merchant (tenant) API key. */
export const MERCHANT_API_KEY_HEADER = 'x-tenant-api-key' as const;
