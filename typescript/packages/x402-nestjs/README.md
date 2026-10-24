<img src="https://raw.githubusercontent.com/cryptonly-net/.github/main/profile/assets/header-banner.svg" alt="Cryptonly" width="100%" />

<div align="center">

# Cryptonly x402 for NestJS

Accept x402 payments in NestJS, with Cryptonly as the facilitator.

[Website](https://cryptonly.net) · [Documentation](https://docs.cryptonly.net/guides/x402/) · [Contact](https://cryptonly.net/contact/)

</div>

---

Cryptonly verifies and settles each payment, and pays the network fee. Payments go straight to your wallet. Mark a handler with `@X402()` and its price comes from the Cryptonly dashboard, so a price change needs no deploy. An endpoint can have a price in each currency you accept, such as USDC on Base and on Solana: the `402` offers all of them and the buyer picks one. Works on the Express and the Fastify platform.

You need a Cryptonly API key with the `x402.verify` and `x402.settle` scopes. The [quickstart](https://docs.cryptonly.net/guides/x402/quickstart/) covers getting one.

## Install

```bash
npm install @cryptonly/x402-nestjs @x402/core @x402/evm
```

## Use

Register the module once:

```ts
import { Module } from '@nestjs/common';
import { X402Module } from '@cryptonly/x402-nestjs';

@Module({
  imports: [X402Module.forRoot({ apiKey: process.env.CRYPTONLY_API_KEY!, isGlobal: true })],
  controllers: [WeatherController],
})
export class AppModule {}
```

Then mark the paid handlers:

```ts
import { Controller, Get, Param } from '@nestjs/common';
import { X402, X402Payment, type X402VerifiedPayment } from '@cryptonly/x402-nestjs';

@Controller('weather')
export class WeatherController {
  @X402() // priced in the dashboard as GET /weather/:city
  @Get(':city')
  get(@Param('city') city: string, @X402Payment() payment: X402VerifiedPayment) {
    return { city, temperatureC: 21, paidBy: payment.payer };
  }
}
```

With `@nestjs/config`, use `forRootAsync`:

```ts
X402Module.forRootAsync({
  isGlobal: true,
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({ apiKey: config.getOrThrow('CRYPTONLY_API_KEY') }),
});
```

## How it works

- **Only `@X402()` routes are paid.** Put it on a handler, or on a controller to cover all its handlers. A route without it is served for free, even if the dashboard prices it.
- **Price in the dashboard.** The handler's method and path must match a dashboard endpoint. Price the full public path, including any `setGlobalPrefix()` or version prefix.
- **Fails closed.**
  - An `@X402()` route the dashboard doesn't price answers `503` (`x402_route_unpriced`).
  - Until the prices first load, paid routes answer `503` with `Retry-After`.
  - At startup, and on each price change, the module logs a warning for each mismatch between the dashboard and the handlers.
- **Order.** Guards run first, then the payment check, then pipes and the handler. A request your auth guard rejects is never asked to pay.
- **Charging.** The payment is verified before the handler and settled after it returns. An exception, including a `ValidationPipe` error, cancels it, so the buyer isn't charged.
- **`@X402Payment()`** gives the verified payment: `payer`, `network`, `amount`, `asset`, `payTo`. It is verified but not yet settled.

## Price in code

Pass a stock `@x402/core` route config to `@X402()`. That route then needs no dashboard price:

```ts
@X402({
  accepts: { scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: process.env.PAY_TO! },
  description: 'Current weather',
})
@Get('now')
now() {
  return { temperatureC: 21 };
}
```

`payTo` must be a wallet you added in the dashboard.

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
| `logger` | Nest `Logger` | Gets reload failures and skipped routes. |
| `waitForConfig` | `false` | Load the prices during bootstrap, so a bad key fails startup. When `false`, they load on the first paid request. |
| `isGlobal` | `false` | Make the module global, so any module's controllers can use `@X402()`. |
| `pathPrefix` | — | Prefix a proxy strips before the request reaches the app. See [Behind a proxy](#behind-a-proxy). |
| `publicPath` | — | Maps the app's path to the public path, for other rewrites. |
| `publicBaseUrl` | the request's | Public origin buyers call, for `resource.url` in the `402`. |

Inject `X402Service` for `ready()`, `refresh()`, `routes()` and the `facilitator` client.

## Behind a proxy

Dashboard prices are keyed by the public path. If a reverse proxy rewrites the path, tell the module how, or the paths don't match and `@X402()` routes answer `503` (a warning names the dashboard path that nearly matched).

```ts
// The proxy serves /v1/weather from the app's /weather:
X402Module.forRoot({ apiKey, pathPrefix: '/v1', publicBaseUrl: 'https://api.example.com' });

// The proxy adds /internal:
X402Module.forRoot({ apiKey, publicPath: (path) => path.replace(/^\/internal/, '') });
```

`publicBaseUrl` sets the URL buyers see in the `402`. Without it, the URL is built from the request's host and protocol. The global prefix is part of the app's path: with `setGlobalPrefix('api')`, `pathPrefix: '/v1'` prices `/v1/api/...`. Prices set in code (`@X402({ accepts })`) don't depend on the path.

## Not supported

- Handlers that take `@Res()` without `passthrough: true`: the payment can't be settled before the response is sent.
- The HTML paywall for browsers. Paid routes answer `402` with JSON, for x402 clients.

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
