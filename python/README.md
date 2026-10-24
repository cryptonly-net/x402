<img src="https://raw.githubusercontent.com/cryptonly-net/.github/main/profile/assets/header-banner.svg" alt="Cryptonly" width="100%" />

<div align="center">

# Cryptonly — x402 facilitator

Facilitator client for x402 payments.

[Website](https://cryptonly.net) · [Documentation](https://docs.cryptonly.net/api-reference/openapi/operations/x402supported/) · [Contact](https://cryptonly.net/contact/)

</div>

---

Pass the async client to `x402ResourceServer` for FastAPI. Pass the sync client to `x402ResourceServerSync` for Flask.

```bash
pip install cryptonly-x402 "x402[fastapi,evm]"
```

`x402` >=2 is a dependency. Install the extra for the framework and chain you use, such as `x402[fastapi,evm]` or `x402[flask,evm]`.

```python
import os

from cryptonly_x402 import CryptonlyFacilitatorClient
from x402.mechanisms.evm.exact import ExactEvmServerScheme
from x402.server import x402ResourceServer

facilitator = CryptonlyFacilitatorClient(os.environ["CRYPTONLY_API_KEY"])

server = x402ResourceServer(facilitator)
server.register("eip155:8453", ExactEvmServerScheme())
```

`api_key` is your Cryptonly API key. It is sent as `x-tenant-api-key` on verify, settle, and supported.

```python
facilitator = CryptonlyFacilitatorClient(os.environ["CRYPTONLY_API_KEY"])
```

Flask uses the sync client:

```python
from cryptonly_x402 import CryptonlyFacilitatorClientSync
from x402.mechanisms.evm.exact import ExactEvmServerScheme
from x402.server import x402ResourceServerSync

facilitator = CryptonlyFacilitatorClientSync(os.environ["CRYPTONLY_API_KEY"])

server = x402ResourceServerSync(facilitator)
server.register("eip155:8453", ExactEvmServerScheme())
```

Set `sandbox=True` to use the sandbox facilitator, which settles on Base Sepolia (`eip155:84532`).
