<img src="https://raw.githubusercontent.com/cryptonly-net/.github/main/profile/assets/header-banner.svg" alt="Cryptonly" width="100%" />

<div align="center">

# Cryptonly — x402 facilitator

Accept x402 payments in Node.js, with Cryptonly as the facilitator.

[Website](https://cryptonly.net) · [Documentation](https://docs.cryptonly.net/guides/x402/) · [Contact](https://cryptonly.net/contact/)

</div>

---

Cryptonly verifies and settles each payment, and pays the network fee. Payments go straight to your wallet. There are two ways to use this package:

- **Prices in the dashboard.** `cryptonlyPaymentMiddleware` for Express loads your prices from the Cryptonly dashboard. A price change needs no deploy.
- **Prices in your code.** `CryptonlyFacilitatorClient` plugs into the stock `@x402/express`, `@x402/hono` or `@x402/next` middleware.

You need a Cryptonly API key with the `x402.verify` and `x402.settle` scopes. The [quickstart](https://docs.cryptonly.net/guides/x402/quickstart/) covers getting one.

## Prices in the dashboard

```bash
npm install @cryptonly/x402 @x402/core @x402/express @x402/evm express
```

```ts
import express from 'express';
import { cryptonlyPaymentMiddleware } from '@cryptonly/x402/express';

const app = express();
app.get('/health', (_req, res) => res.send('ok')); // free routes go first

const payments = cryptonlyPaymentMiddleware({ apiKey: process.env.CRYPTONLY_API_KEY! });
app.use(payments);

// Priced in the dashboard as GET /weather/:city
app.get('/weather/:city', (req, res) => {
  res.json({ city: req.params.city, temperatureC: 21 });
});

await payments.ready(); // fails at startup if the prices can't load
app.listen(4021);
```

The middleware reloads your prices every minute. It fails closed, so a paid route is never served for free:

- Until the first load succeeds, every request through it gets `503` with `Retry-After`. This happens with a bad key, an inactive account or no payout wallet.
- If a later reload fails, it keeps the last good prices and logs a warning.

| Option | Default | |
| --- | --- | --- |
| `apiKey` | required | Your Cryptonly API key. |
| `sandbox` | `false` | Use the sandbox. |
| `baseUrl` | production | Another API origin. Takes precedence over `sandbox`. |
| `refreshIntervalMs` | `60000` | How often to reload prices. `0` turns it off. |
| `retryAfterMs` | `5000` | After a failed first load, how long to answer `503` before the next try. |
| `schemes` | `[new ExactEvmScheme()]` | Schemes for Base. |
| `svmSchemes` | `[new ExactSvmScheme()]` if `@x402/svm` is installed | Schemes for Solana. |
| `paywallConfig` | — | Passed to the stock `paymentMiddleware`. |
| `logger` | `console` | Gets reload failures and skipped routes. |
| `createMiddleware` | stock `paymentMiddleware` | Builds the inner middleware, for example to add hooks. |

The middleware also has `ready()`, `refresh()`, `routes()` and `close()`.

Using another framework? Build the routes with `fetchX402Config()` and `routesFromConfig()`, and pass them to its stock x402 middleware.

## Prices in your code

```bash
npm install @cryptonly/x402 @x402/core @x402/express @x402/evm
```

```ts
import { CryptonlyFacilitatorClient } from '@cryptonly/x402';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';

const facilitator = new CryptonlyFacilitatorClient({ apiKey: process.env.CRYPTONLY_API_KEY! });
const server = new x402ResourceServer(facilitator).register('eip155:8453', new ExactEvmScheme());

app.use(
  paymentMiddleware(
    {
      'GET /weather/:city': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: process.env.PAY_TO! }],
      },
    },
    server,
  ),
);
```

`CryptonlyFacilitatorClient` takes `apiKey`, `sandbox` and `baseUrl`, as above. `payTo` must be a wallet you added in the dashboard.

## Solana

Install `@x402/svm` and `@solana/kit`, and add a Solana payout wallet in the dashboard. With prices in your code, register `ExactSvmScheme` from `@x402/svm/exact/server` for `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`.

## Sandbox

Pass `sandbox: true` and use a key from your [sandbox account](https://docs.cryptonly.net/guides/sandbox-environment/). The sandbox settles on Base Sepolia (`eip155:84532`) and Solana Devnet.

## Learn more

- [x402 quickstart](https://docs.cryptonly.net/guides/x402/quickstart/)
- [Discovery](https://docs.cryptonly.net/guides/x402/discovery/): list your endpoints for AI agents
- [Reference](https://docs.cryptonly.net/guides/x402/reference/): key scopes, limits and reason codes

## License

[MIT](https://github.com/cryptonly-net/x402/blob/main/LICENSE)
