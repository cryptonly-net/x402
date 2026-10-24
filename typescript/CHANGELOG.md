# Changelog

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
