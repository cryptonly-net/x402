import pytest

from cryptonly_x402 import (
    MERCHANT_API_BASE_URL,
    MERCHANT_API_KEY_HEADER,
    SANDBOX_MERCHANT_API_BASE_URL,
    CryptonlyFacilitatorClient,
    CryptonlyFacilitatorClientSync,
)


@pytest.mark.parametrize(
    "client_cls",
    [CryptonlyFacilitatorClient, CryptonlyFacilitatorClientSync],
)
def test_requires_an_api_key(client_cls):
    with pytest.raises(TypeError, match="api_key is required"):
        client_cls("")


@pytest.mark.parametrize(
    "client_cls",
    [CryptonlyFacilitatorClient, CryptonlyFacilitatorClientSync],
)
def test_points_at_production_by_default_and_sandbox_when_asked(client_cls):
    production = client_cls("k")
    assert production.url == f"{MERCHANT_API_BASE_URL}/x402"

    sandbox = client_cls("k", sandbox=True)
    assert sandbox.url == f"{SANDBOX_MERCHANT_API_BASE_URL}/x402"
    assert sandbox._get_settle_headers()[MERCHANT_API_KEY_HEADER] == "k"
    assert sandbox._get_verify_headers()[MERCHANT_API_KEY_HEADER] == "k"
    assert sandbox._get_supported_headers()[MERCHANT_API_KEY_HEADER] == "k"
