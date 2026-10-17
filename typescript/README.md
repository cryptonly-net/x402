<img src="https://raw.githubusercontent.com/cryptonly-net/.github/main/profile/assets/header-banner.svg" alt="Cryptonly" width="100%" />

<div align="center">

# Cryptonly — x402 facilitator

Facilitator client for x402 payments.

[Website](https://cryptonly.net) · [Documentation](https://cryptonly.gitbook.io/docs) · [Contact](https://cryptonly.net/contact/)

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

`apiKey` is your Cryptonly API key. It is sent as `x-tenant-api-key` on verify and settle.

```ts
const facilitator = new CryptonlyFacilitatorClient({
  apiKey: process.env.CRYPTONLY_API_KEY!,
});
```
