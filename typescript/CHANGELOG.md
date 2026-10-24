# Changelog

## Unreleased

- **The discovery feed moved** to `https://api.cryptonly.net/x402/discovery/resources` (sandbox: `https://sandbox-api.cryptonly.net/...`). The merchant API host no longer serves it.
  - `withBazaar(new CryptonlyFacilitatorClient(...))` no longer lists resources. Use `withBazaar(new HTTPFacilitatorClient({ url: DISCOVERY_FEED_URL }))`; the feed needs no key.
  - New: `DISCOVERY_FEED_URL` and `SANDBOX_DISCOVERY_FEED_URL`.
- **Behind a reverse proxy that rewrites paths.** Three new options in every package: `pathPrefix`, `publicPath` and `publicBaseUrl`.
  - Dashboard prices are keyed by the public path, so the path the app sees is now mapped to it before matching.
  - `resource.url` in the `402` is built on the public URL.
  - Before this, a rewritten path was served free by the Express middleware and the Fastify plugin, and got a `503` from NestJS.
  - The core exports `createPublicRequestMapper()` and `createHTTPResourceServer()` for other frameworks.
- **NestJS: the unpriced-route warning is logged once per handler.** Previously it was logged once per request path, and every new path parameter added a line and an entry kept in memory.
  - The warning now names a dashboard path that differs only by a prefix, if there is one.

## 0.6.0

No code changes. The first release published from CI, with npm provenance.

## 0.5.0

**Breaking:** the Express middleware moved to its own package.

```diff
- npm install @cryptonly/x402 @x402/core @x402/express @x402/evm express
+ npm install @cryptonly/x402-express @x402/core @x402/express @x402/evm express

- import { cryptonlyPaymentMiddleware } from '@cryptonly/x402/express';
+ import { cryptonlyPaymentMiddleware } from '@cryptonly/x402-express';
```

Its options and behaviour are unchanged.

- New `@cryptonly/x402-fastify`: a Fastify plugin with prices from the dashboard.
- New `@cryptonly/x402-nestjs`: `X402Module`, the `@X402()` and `@X402Payment()` decorators, on the Express and Fastify platforms.
- `@cryptonly/x402` adds `createX402RouteSource()` and `createResourceServer()`: the dashboard price loader the framework packages share.
