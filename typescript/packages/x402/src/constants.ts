/** Default origin for the merchant API (no path; no trailing slash). */
export const MERCHANT_API_BASE_URL = 'https://api-merchant.cryptonly.net' as const;

/** Origin for the sandbox merchant API. */
export const SANDBOX_MERCHANT_API_BASE_URL =
  'https://sandbox-api-merchant.cryptonly.net' as const;

/** Header that carries the merchant (tenant) API key. */
export const MERCHANT_API_KEY_HEADER = 'x-tenant-api-key' as const;
