import type { X402Config } from './config.js';

export const PAYER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
export const SETTLE_TX = `0x${'ab'.repeat(32)}`;

/** The base URL the fixtures' facilitator answers on. */
export const FACILITATOR_BASE_URL = 'http://api.test';

/** What the fake facilitator saw. */
export type FacilitatorCalls = { verified: unknown[]; settled: unknown[] };

/**
 * A global `fetch` for the facilitator (`/supported`, `/verify`, `/settle`)
 * that accepts every payment and records the calls. Anything else goes to
 * `realFetch`.
 */
export function facilitatorFetch(
  calls: FacilitatorCalls,
  realFetch: typeof fetch,
  options: { settle?: 'ok' | 'fail' } = {},
): typeof fetch {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === `${FACILITATOR_BASE_URL}/x402/supported`) {
      return json({
        kinds: [
          { x402Version: 2, scheme: 'exact', network: 'eip155:84532' },
          { x402Version: 2, scheme: 'exact', network: 'eip155:8453' },
        ],
        extensions: [],
        signers: {},
      });
    }
    if (url === `${FACILITATOR_BASE_URL}/x402/verify`) {
      calls.verified.push(JSON.parse(String(init?.body)));
      return json({ isValid: true, payer: PAYER });
    }
    if (url === `${FACILITATOR_BASE_URL}/x402/settle`) {
      calls.settled.push(JSON.parse(String(init?.body)));
      return options.settle === 'fail'
        ? json({
            success: false,
            errorReason: 'insufficient_funds',
            transaction: '',
            network: 'eip155:84532',
            payer: PAYER,
          })
        : json({ success: true, transaction: SETTLE_TX, network: 'eip155:84532', payer: PAYER });
    }
    return realFetch(input as string, init);
  }) as typeof fetch;
}

/** A `fetch` that answers `GET /x402/config` with `config`. */
export function configFetchOf(config: X402Config): typeof fetch {
  return (async () => new Response(JSON.stringify(config), { status: 200 })) as typeof fetch;
}

/** Decodes a base64 JSON header such as `PAYMENT-REQUIRED`. */
export function decodeHeader<T = Record<string, any>>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as T;
}

/** A `PAYMENT-SIGNATURE` header that accepts the offered requirement at `index`. */
export function paymentFor(paymentRequired: string, index = 0): string {
  const required = decodeHeader(paymentRequired);
  const payload = {
    x402Version: 2,
    resource: required.resource,
    accepted: required.accepts[index],
    payload: { signature: '0x', authorization: { from: PAYER } },
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Silences `console.error` for the stock Express and Fastify middleware:
 * under jest's VM they cannot `import()` the bazaar extension to validate
 * routes and log it; plain Node loads it. Restore the returned spy.
 */
export function muteBazaarImportLog(): jest.SpyInstance {
  return jest.spyOn(console, 'error').mockImplementation(() => {});
}
