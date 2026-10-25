"""Cryptonly merchant API origins, the discovery feed and the tenant API key header."""

MERCHANT_API_BASE_URL = "https://api-merchant.cryptonly.net"
SANDBOX_MERCHANT_API_BASE_URL = "https://sandbox-api-merchant.cryptonly.net"
MERCHANT_API_KEY_HEADER = "x-tenant-api-key"

# The facilitator URL of the public x402 discovery (Bazaar) feed, for
# with_bazaar(HTTPFacilitatorClientSync(FacilitatorConfig(url=DISCOVERY_FACILITATOR_URL))).
# The feed itself is at <url>/discovery/resources. It is on the public API
# host, not the merchant API, and needs no key.
DISCOVERY_FACILITATOR_URL = "https://api.cryptonly.net/x402"
SANDBOX_DISCOVERY_FACILITATOR_URL = "https://sandbox-api.cryptonly.net/x402"
