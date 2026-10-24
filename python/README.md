<img src="https://raw.githubusercontent.com/cryptonly-net/.github/main/profile/assets/header-banner.svg" alt="Cryptonly" width="100%" />

<div align="center">

# Cryptonly — x402 facilitator

Accept x402 payments in Python, with Cryptonly as the facilitator.

[Website](https://cryptonly.net) · [Documentation](https://docs.cryptonly.net/guides/x402/) · [Contact](https://cryptonly.net/contact/)

</div>

---

Cryptonly verifies and settles each payment, and pays the network fee. Payments go straight to your wallet. This package plugs Cryptonly into the stock [`x402`](https://pypi.org/project/x402/) middleware for FastAPI and Flask.

You need a Cryptonly API key with the `x402.verify` and `x402.settle` scopes. The [quickstart](https://docs.cryptonly.net/guides/x402/quickstart/) covers getting one.

## FastAPI

```bash
pip install cryptonly-x402 "x402[fastapi,evm]" fastapi uvicorn
```

```python
import os

from cryptonly_x402 import CryptonlyFacilitatorClient
from fastapi import FastAPI
from x402.http import PaymentOption, RouteConfig
from x402.http.middleware.fastapi import PaymentMiddlewareASGI
from x402.mechanisms.evm.exact import ExactEvmServerScheme
from x402.server import x402ResourceServer

facilitator = CryptonlyFacilitatorClient(os.environ["CRYPTONLY_API_KEY"])
server = x402ResourceServer(facilitator)
server.register("eip155:8453", ExactEvmServerScheme())

routes = {
    "GET /weather/:city": RouteConfig(
        accepts=PaymentOption(scheme="exact", price="$0.01", network="eip155:8453", pay_to=os.environ["PAY_TO"]),
    ),
}

app = FastAPI()
app.add_middleware(PaymentMiddlewareASGI, routes=routes, server=server)


@app.get("/weather/{city}")
async def weather(city: str):
    return {"city": city, "temperatureC": 21}
```

`PAY_TO` must be a wallet you added in the dashboard.

## Flask

Install `x402[flask,evm]` and use the sync classes:

```python
import os

from cryptonly_x402 import CryptonlyFacilitatorClientSync
from x402.mechanisms.evm.exact import ExactEvmServerScheme
from x402.server import x402ResourceServerSync

facilitator = CryptonlyFacilitatorClientSync(os.environ["CRYPTONLY_API_KEY"])
server = x402ResourceServerSync(facilitator)
server.register("eip155:8453", ExactEvmServerScheme())
```

## Sandbox

Pass `sandbox=True` and use a key from your [sandbox account](https://docs.cryptonly.net/guides/sandbox-environment/). The sandbox settles on Base Sepolia (`eip155:84532`) and Solana Devnet.

```python
facilitator = CryptonlyFacilitatorClient(os.environ["CRYPTONLY_API_KEY"], sandbox=True)
```

## Learn more

- [Prices in your code](https://docs.cryptonly.net/guides/x402/prices-in-code/): Python, Express and Go examples
- [Discovery](https://docs.cryptonly.net/guides/x402/discovery/): list your endpoints for AI agents
- [Reference](https://docs.cryptonly.net/guides/x402/reference/): key scopes, limits and reason codes

## License

[MIT](https://github.com/cryptonly-net/x402/blob/main/LICENSE)
