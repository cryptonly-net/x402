<img src="https://raw.githubusercontent.com/cryptonly-net/.github/main/profile/assets/header-banner.svg" alt="Cryptonly" width="100%" />

<div align="center">

# Cryptonly x402 for Express

Accept x402 payments in Express, with Cryptonly as the facilitator.

[Website](https://cryptonly.net) · [Documentation](https://docs.cryptonly.net/guides/x402/) · [Contact](https://cryptonly.net/contact/)

</div>

---

Cryptonly verifies and settles each payment, and pays the network fee. Payments go straight to your wallet. Your prices live in the Cryptonly dashboard, so a price change needs no deploy.

You need a Cryptonly API key with the `x402.verify` and `x402.settle` scopes. The [quickstart](https://docs.cryptonly.net/guides/x402/quickstart/) covers getting one.

## Install

```bash
npm install @cryptonly/x402-express @x402/core @x402/express @x402/evm express
```

## Use

```ts
import express from 'express';
import { cryptonlyPaymentMiddleware } from '@cryptonly/x402-express';

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

It reloads your prices every minute and fails closed, so a paid route is never served for free:

- Until the first load succeeds, every request through it gets `503` with `Retry-After`. This happens with a bad key, an inactive account or no payout wallet.
- If a later reload fails, it keeps the last good prices and logs a warning.

The buyer is charged only when the handler succeeds. A `4xx`/`5xx` response or a thrown error cancels the payment.

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
| `paywallConfig` | — | Passed to the stock `paymentMiddleware`. |
| `pathPrefix` | — | Prefix a proxy strips before the request reaches the app. See [Behind a proxy](#behind-a-proxy). |
| `publicPath` | — | Maps the app's path to the public path, for other rewrites. |
| `publicBaseUrl` | the request's | Public origin buyers call, for `resource.url` in the `402`. |
| `createMiddleware` | stock `paymentMiddleware` | Builds the inner middleware, for example to add hooks. |

The middleware also has `ready()`, `refresh()`, `routes()` and `close()`.

On NestJS, use [`@cryptonly/x402-nestjs`](https://www.npmjs.com/package/@cryptonly/x402-nestjs) for decorators. This middleware also works there, applied with `consumer.apply(payments).forRoutes(...)`.

## Behind a proxy

Dashboard prices are keyed by the public path. If a reverse proxy rewrites the path, tell the middleware how, or the paths don't match and the routes are served **for free**: the middleware only gates the paths it knows.

```ts
// The proxy serves /v1/weather from the app's /weather:
cryptonlyPaymentMiddleware({ apiKey, pathPrefix: '/v1', publicBaseUrl: 'https://api.example.com' });

// The proxy adds /internal:
cryptonlyPaymentMiddleware({ apiKey, publicPath: (path) => path.replace(/^\/internal/, '') });
```

`publicBaseUrl` sets the URL buyers see in the `402`. Without it, the URL is built from the request's host and protocol. Behind a proxy, set Express `trust proxy` so the protocol is right.

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
