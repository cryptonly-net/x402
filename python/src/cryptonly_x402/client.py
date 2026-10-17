"""Cryptonly facilitator clients for the x402 protocol."""

from __future__ import annotations

from x402.http import (
    FacilitatorConfig,
    HTTPFacilitatorClient,
    HTTPFacilitatorClientSync,
)
from x402.http.facilitator_client_base import AuthHeaders

from .constants import (
    MERCHANT_API_BASE_URL,
    MERCHANT_API_KEY_HEADER,
    SANDBOX_MERCHANT_API_BASE_URL,
)


class _ApiKeyAuth:
    """Sends the Cryptonly API key on verify, settle, and supported."""

    def __init__(self, api_key: str) -> None:
        self._headers = {MERCHANT_API_KEY_HEADER: api_key}

    def get_auth_headers(self) -> AuthHeaders:
        headers = dict(self._headers)
        return AuthHeaders(verify=headers, settle=dict(headers), supported=dict(headers))


def _resolve_facilitator_url(sandbox: bool) -> str:
    origin = SANDBOX_MERCHANT_API_BASE_URL if sandbox else MERCHANT_API_BASE_URL
    return f"{origin}/x402"


def _require_api_key(api_key: str, client_name: str) -> str:
    if not api_key:
        raise TypeError(f"{client_name}: api_key is required")
    return api_key


class CryptonlyFacilitatorClient(HTTPFacilitatorClient):
    """Async Cryptonly facilitator client.

    Pass it to ``x402ResourceServer`` for FastAPI and other async servers.
    """

    def __init__(self, api_key: str, *, sandbox: bool = False) -> None:
        key = _require_api_key(api_key, "CryptonlyFacilitatorClient")
        super().__init__(
            FacilitatorConfig(
                url=_resolve_facilitator_url(sandbox),
                auth_provider=_ApiKeyAuth(key),
            )
        )


class CryptonlyFacilitatorClientSync(HTTPFacilitatorClientSync):
    """Sync Cryptonly facilitator client.

    Pass it to ``x402ResourceServerSync`` for Flask and other sync servers.
    """

    def __init__(self, api_key: str, *, sandbox: bool = False) -> None:
        key = _require_api_key(api_key, "CryptonlyFacilitatorClientSync")
        super().__init__(
            FacilitatorConfig(
                url=_resolve_facilitator_url(sandbox),
                auth_provider=_ApiKeyAuth(key),
            )
        )
