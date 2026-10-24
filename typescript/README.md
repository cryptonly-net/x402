# Cryptonly x402 — TypeScript

Accept x402 payments in Node.js, with Cryptonly as the facilitator.

| Package | For | |
| --- | --- | --- |
| [`@cryptonly/x402-express`](packages/x402-express) | Express | Middleware, prices from the dashboard |
| [`@cryptonly/x402-fastify`](packages/x402-fastify) | Fastify | Plugin, prices from the dashboard |
| [`@cryptonly/x402-nestjs`](packages/x402-nestjs) | NestJS (Express or Fastify) | Module and `@X402()` decorator |
| [`@cryptonly/x402`](packages/x402) | Anything else | Facilitator client and dashboard price loader, shared by the others |

All four are released together with the same version. See the [changelog](CHANGELOG.md).

## Develop

```bash
npm ci
npm test          # every package; no build needed
npm run typecheck
npm run build     # core first, then the framework packages
```
