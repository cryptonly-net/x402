<img src="https://raw.githubusercontent.com/cryptonly-net/.github/main/profile/assets/header-banner.svg" alt="Cryptonly" width="100%" />

<div align="center">

# Cryptonly — x402 facilitator

Accept x402 payments in stablecoins on Base and Solana, with Cryptonly as the facilitator.

[Website](https://cryptonly.net) · [Documentation](https://docs.cryptonly.net/guides/x402/) · [Contact](https://cryptonly.net/contact/)

</div>

---

| Language | Package | |
| --- | --- | --- |
| TypeScript | [`@cryptonly/x402-express`](https://www.npmjs.com/package/@cryptonly/x402-express) | Express middleware with prices from the dashboard. [README](typescript/packages/x402-express/README.md) |
| | [`@cryptonly/x402-fastify`](https://www.npmjs.com/package/@cryptonly/x402-fastify) | Fastify plugin with prices from the dashboard. [README](typescript/packages/x402-fastify/README.md) |
| | [`@cryptonly/x402-nestjs`](https://www.npmjs.com/package/@cryptonly/x402-nestjs) | NestJS module and `@X402()` decorator, on Express or Fastify. [README](typescript/packages/x402-nestjs/README.md) |
| | [`@cryptonly/x402`](https://www.npmjs.com/package/@cryptonly/x402) | Facilitator client for stock x402 middleware, and the shared price loader. [README](typescript/packages/x402/README.md) |
| Python | [`cryptonly-x402`](https://pypi.org/project/cryptonly-x402/) | Facilitator client for FastAPI and Flask. [README](python/README.md) |

For Go and other languages, use the stock x402 facilitator client with `https://api-merchant.cryptonly.net/x402` and your API key in the `x-tenant-api-key` header. See [prices in your code](https://docs.cryptonly.net/guides/x402/prices-in-code/).

New to x402? Start with the [quickstart](https://docs.cryptonly.net/guides/x402/quickstart/).

## License

[MIT](LICENSE)
