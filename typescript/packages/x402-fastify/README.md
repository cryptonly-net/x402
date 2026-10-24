<img src="https://raw.githubusercontent.com/cryptonly-net/.github/main/profile/assets/header-banner.svg" alt="Cryptonly" width="100%" />

<div align="center">

# Cryptonly x402 for Fastify

Accept x402 payments in Fastify, with Cryptonly as the facilitator.

[Website](https://cryptonly.net) · [Documentation](https://docs.cryptonly.net/guides/x402/) · [Contact](https://cryptonly.net/contact/)

</div>

---

Cryptonly verifies and settles each payment, and pays the network fee. Payments go straight to your wallet. Your prices live in the Cryptonly dashboard, so a price change needs no deploy.

You need a Cryptonly API key with the `x402.verify` and `x402.settle` scopes. The [quickstart](https://docs.cryptonly.net/guides/x402/quickstart/) covers getting one.

## Install

```bash
npm install @cryptonly/x402-fastify @x402/core @x402/fastify @x402/evm fastify
```

## Use

```ts
import Fastify from 'fastify';
import { cryptonlyPayments } from '@cryptonly/x402-fastify';

const app = Fastify();
app.get('/health', async () => 'ok');

// Paid routes go in the plugin's scope.
await app.register(async (paid) => {
  await paid.register(cryptonlyPayments, { apiKey: process.env.CRYPTONLY_API_KEY! });

  // Priced in the dashboard as GET /weather/:city
  paid.get('/weather/:city', async (request) => {
    const { city } = request.params as { city: string };
    return { city, temperatureC: 21 };
  });

  await paid.cryptonlyX402.ready(); // fails at startup if the prices can't load
});

await app.listen({ port: 4021 });
```

`cryptonlyPayments` gates every route in the scope it is registered in. Register it at the root to cover the whole app. Routes the dashboard doesn't price pass through.

It reloads your prices every minute and fails closed, so a paid route is never served for free:

- Until the first load succeeds, every request through it gets `503` with `Retry-After`. This happens with a bad key, an inactive account or no payout wallet.
- If a later reload fails, it keeps the last good prices and logs a warning.

The buyer is charged only when the handler succeeds. A `4xx`/`5xx` reply or a thrown error cancels the payment.

## Options

| Option | Default | |
| --- | --- | --- |
| `apiKey` | required | Your Cryptonly API key. |
| `sandbox` | `false` | Use the sandbox. |
| `baseUrl` | production | Another API origin. Takes precedence over `sandbox`. |
| `refreshIntervalMs` | `60000` | How often to reload prices. `0` turns it off. |
| `retryAfterMs` | `5000` | After a failed first load, how long to answer `503` before the next try. |
| `schemes` | `[new ExactEvmScheme()]` | Schemes for Base. |
| `svmSchemes` | `[new ExactSvmScheme()]` if `@x402/svm` is installed | Schemes for Solana. |
| `logger` | `console` | Gets reload failures and skipped routes. |
| `paywallConfig` | — | Passed to the stock `@x402/fastify` hooks. |

`app.cryptonlyX402` has `ready()`, `refresh()`, `routes()` and `close()`. `app.close()` stops the refresh.

## Solana

Install `@x402/svm` and `@solana/kit`, and add a Solana payout wallet in the dashboard. Solana prices then work with no other change.

## Sandbox

Pass `sandbox: true` and use a key from your [sandbox account](https://docs.cryptonly.net/guides/sandbox-environment/). The sandbox settles on Base Sepolia (`eip155:84532`) and Solana Devnet.

## Learn more

- [x402 quickstart](https://docs.cryptonly.net/guides/x402/quickstart/)
- [Discovery](https://docs.cryptonly.net/guides/x402/discovery/): list your endpoints for AI agents
- [Reference](https://docs.cryptonly.net/guides/x402/reference/): key scopes, limits and reason codes

## License

[MIT](https://github.com/cryptonly-net/x402/blob/main/LICENSE)
