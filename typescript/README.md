<img src="https://raw.githubusercontent.com/cryptonly-net/.github/main/profile/assets/header-banner.svg" alt="Cryptonly" width="100%" />

<div align="center">

# Cryptonly — x402 facilitator

Facilitator client for x402 payments.

[Website](https://cryptonly.net) · [Documentation](https://docs.cryptonly.net/api-reference/openapi/operations/x402supported/) · [Contact](https://cryptonly.net/contact/)

</div>

---

Pass it to `x402ResourceServer` from `@x402/express`, `@x402/hono`, or `@x402/next`.

```bash
npm install @cryptonly/x402
```

`@x402/core` ^2 is a peer dependency. Also install the framework package you use, such as `@x402/express` or `@x402/evm`.

```ts
import { CryptonlyFacilitatorClient } from '@cryptonly/x402';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { x402ResourceServer } from '@x402/express';

const facilitator = new CryptonlyFacilitatorClient({
  apiKey: process.env.CRYPTONLY_API_KEY!,
});

const server = new x402ResourceServer(facilitator).register(
  'eip155:8453',
  new ExactEvmScheme(),
);
```

## Options

| Option | Default | |
| --- | --- | --- |
| `apiKey` | required | Your Cryptonly API key, with the `x402.verify` and `x402.settle` scopes. Sent as `x-tenant-api-key` on every facilitator call. |
| `sandbox` | `false` | Use the sandbox facilitator, which settles on Base Sepolia (`eip155:84532`). |
| `baseUrl` | — | Merchant API origin, for example a local API. `/x402` is appended. Takes precedence over `sandbox`. |

```ts
// Sandbox: Base Sepolia, with test USDC from the Circle faucet.
const facilitator = new CryptonlyFacilitatorClient({
  apiKey: process.env.CRYPTONLY_API_KEY!,
  sandbox: true,
});
const server = new x402ResourceServer(facilitator).register(
  'eip155:84532',
  new ExactEvmScheme(),
);
```

## Dashboard-configured routes

`@cryptonly/x402/express` reads your paid resources, prices and payout address from the Cryptonly dashboard, so you do not write routes in code. A price change in the dashboard reaches production within a minute, without a deploy.

```bash
npm install @cryptonly/x402 @x402/core @x402/express @x402/evm express
```

```ts
import express from 'express';
import { cryptonlyPaymentMiddleware } from '@cryptonly/x402/express';

const app = express();

app.get('/health', (_req, res) => res.send('ok')); // free routes first

const payments = cryptonlyPaymentMiddleware({
  apiKey: process.env.CRYPTONLY_API_KEY!, // scopes x402.verify and x402.settle
});
app.use(payments);

// Priced in the dashboard as `GET /weather/:city`.
app.get('/weather/:city', (req, res) => {
  res.json({ city: req.params.city, temperatureC: 21 });
});

await payments.ready(); // optional: fail at startup if the config cannot load
app.listen(4021);
```

How it works:

- It loads `GET /x402/config` with your API key on the first request (or on `ready()`), then every minute.
- It turns each resource into a stock `@x402/express` route: `METHOD /path` (or just `/path` for method `*`), the price in atomic units of the chosen asset, your `payTo`, and the token's EIP-712 domain in `extra`. A Permit2-only token gets `assetTransferMethod: 'permit2'` and EIP-2612 gas sponsoring.
- Resources marked discoverable get the bazaar discovery extension, with their input and output schemas, when `@x402/extensions` is installed.
- It rebuilds the stock middleware only when the routes change.

It fails closed, so paid endpoints are never served for free:

- If the first load fails, every request through the middleware answers `503` with `Retry-After` until a load succeeds. This covers a bad key, an account that is not active, or no payout address. Mount the middleware after your free routes.
- If a refresh fails, the last good routes stay in use and a warning is logged.

| Option | Default | |
| --- | --- | --- |
| `apiKey` | required | Same key as for `CryptonlyFacilitatorClient`. It also needs `x402.verify` for `GET /x402/config`. |
| `sandbox`, `baseUrl` | production | As for `CryptonlyFacilitatorClient`. |
| `refreshIntervalMs` | `60000` | How often to reload the configuration. `0` turns refreshing off. |
| `schemes` | `[new ExactEvmScheme()]` | Scheme servers registered on the account's Base network. Resources with another scheme are skipped. |
| `svmSchemes` | `[new ExactSvmScheme()]` when `@x402/svm` is installed, else none | Scheme servers registered on the account's Solana network. Without one, Solana-priced resources are skipped. |
| `paywallConfig` | — | Passed to the stock `paymentMiddleware`. |
| `logger` | `console` | Receives refresh failures and skipped resources. |
| `createMiddleware` | stock `paymentMiddleware` | Builds the inner middleware for a set of routes, for example to add hooks. |

The returned middleware also has these methods:

- `ready()`: load now.
- `refresh()`: reload now. It resolves `true` when the routes changed.
- `routes()`: the routes in use.
- `close()`: stop refreshing. The refresh timer is `unref()`ed and never keeps the process alive.

For another framework, build the routes yourself with `fetchX402Config()` and `routesFromConfig()` from `@cryptonly/x402`, and pass them to its stock x402 middleware.

### Discovery

`CryptonlyFacilitatorClient` also sends the key on bazaar calls:

```ts
import { withBazaar } from '@x402/extensions/bazaar';

const client = withBazaar(new CryptonlyFacilitatorClient({ apiKey }));
const { items } = await client.extensions.bazaar.listResources();
```

## Networks and assets

Production settles on Base (`eip155:8453`) and Solana (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`); sandbox on Base Sepolia (`eip155:84532`) and Solana Devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`). On Base, USDC and EURC settle with EIP-3009, and allowlisted tokens also through Permit2. On Solana, USDC and USDT settle with the `exact` SVM scheme: the buyer signs a token transfer and Cryptonly co-signs it as fee payer (`extra.feePayer` in `GET /x402/supported`). The buyer never needs ETH or SOL. `GET /x402/supported` lists what the facilitator accepts.

To take Solana payments with `cryptonlyPaymentMiddleware`, install `@x402/svm` and `@solana/kit` next to it and price resources in a Solana asset in the dashboard. Payouts are set up per network, so the account also needs a Solana `payTo`.

## Settlement results

USDC goes straight from the buyer to your `payTo` address; Cryptonly never holds it. If the transaction has not mined when `/settle` answers, the answer is `settlement_pending` with the transaction hash. List your settlements, including their final status, with `GET /x402/settlements` (scope `x402.list`) or `client.x402Settlements.list()` in `@cryptonly/sdk`.
