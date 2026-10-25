<img src="https://raw.githubusercontent.com/cryptonly-net/.github/main/profile/assets/header-banner.svg" alt="Cryptonly" width="100%" />

<div align="center">

# Cryptonly — x402 facilitator

Accept x402 payments in Node.js, with Cryptonly as the facilitator.

[Website](https://cryptonly.net) · [Documentation](https://docs.cryptonly.net/guides/x402/) · [Contact](https://cryptonly.net/contact/)

</div>

---

Cryptonly verifies and settles each payment, and pays the network fee. Payments go straight to your wallet.

Pick the package for your framework. Each one loads your prices from the Cryptonly dashboard, so a price change needs no deploy:

| Framework | Package |
| --- | --- |
| Express | [`@cryptonly/x402-express`](https://www.npmjs.com/package/@cryptonly/x402-express) |
| Fastify | [`@cryptonly/x402-fastify`](https://www.npmjs.com/package/@cryptonly/x402-fastify) |
| NestJS (Express or Fastify platform) | [`@cryptonly/x402-nestjs`](https://www.npmjs.com/package/@cryptonly/x402-nestjs) |

This package, `@cryptonly/x402`, is what they share: the facilitator client and the dashboard price loader. Use it directly for prices in your code, or for another framework.

You need a Cryptonly API key with the `x402.verify` and `x402.settle` scopes. The [quickstart](https://docs.cryptonly.net/guides/x402/quickstart/) covers getting one.

## Prices in your code

`CryptonlyFacilitatorClient` plugs into the stock `@x402/express`, `@x402/fastify`, `@x402/hono` or `@x402/next` middleware.

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

`CryptonlyFacilitatorClient` takes `apiKey`, `sandbox` and `baseUrl`. `payTo` must be a wallet you added in the dashboard. On Solana, register `ExactSvmScheme` from `@x402/svm/exact/server` for `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`.

## Prices in the dashboard, another framework

- `fetchX402Config()` and `routesFromConfig()` turn your dashboard prices into stock `@x402/core` routes for any x402 middleware. Each route `accepts` one option per currency the endpoint is priced in.
- `createX402RouteSource()` adds what the framework packages do on top: one load, a refresh every minute, and the last good routes kept when a refresh fails.

```ts
import {
  createHTTPResourceServer,
  createResourceServer,
  createX402RouteSource,
} from '@cryptonly/x402';

const source = createX402RouteSource({ apiKey: process.env.CRYPTONLY_API_KEY! }, (routes, config) =>
  createHTTPResourceServer(
    createResourceServer(config, source.facilitator, source.schemes, source.svmSchemes),
    routes,
  ),
);

await source.ready(); // rejects if the prices can't load
const httpServer = source.current()!.value; // rebuilt only when the prices change
```

Behind a proxy that rewrites paths, build it with `createHTTPResourceServer(resourceServer, routes, createPublicRequestMapper({ pathPrefix: '/v1' }))`. It matches routes and builds `resource.url` on the public path. `publicPath` and `publicBaseUrl` are the other options.

`createHTTPResourceServer()` also registers the bazaar extension (with `@x402/extensions` installed), so the `402` of a discoverable endpoint carries its route template.

## Discovery

Endpoints you list in the dashboard are in the public feed at `https://api.cryptonly.net/x402/discovery/resources`. Every `402` carries your listing name, logo and the endpoint's tags (`resource.serviceName`, `iconUrl`, `tags`).

```ts
import { fetchDiscoveryResources } from '@cryptonly/x402';

const { items } = await fetchDiscoveryResources({ network: 'eip155:8453', limit: 50 });
```

Stock clients read the feed with `withBazaar(new HTTPFacilitatorClient({ url: DISCOVERY_FACILITATOR_URL }))`.

## Sandbox

Pass `sandbox: true` and use a key from your [sandbox account](https://docs.cryptonly.net/guides/sandbox-environment/). The sandbox settles on Base Sepolia (`eip155:84532`) and Solana Devnet.

## Learn more

- [x402 quickstart](https://docs.cryptonly.net/guides/x402/quickstart/)
- [Discovery](https://docs.cryptonly.net/guides/x402/discovery/): list your endpoints for AI agents
- [Reference](https://docs.cryptonly.net/guides/x402/reference/): key scopes, limits and reason codes

## License

[MIT](https://github.com/cryptonly-net/x402/blob/main/LICENSE)
