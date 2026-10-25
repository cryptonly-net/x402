import type { Network } from '@x402/core/types';
import type { X402Config, X402ConfigResource } from './config.js';

export const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const PERMIT2_TOKEN = '0x1111111111111111111111111111111111111111';
export const PAY_TO = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
export const BASE_SEPOLIA: Network = 'eip155:84532';

export function resource(overrides: Partial<X402ConfigResource> = {}): X402ConfigResource {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    method: 'GET',
    path: '/weather',
    prices: [{ amount: '1000', asset: USDC, currencyCode: 'USDC_BASE', network: BASE_SEPOLIA }],
    scheme: 'exact',
    maxTimeoutSeconds: 300,
    description: 'Current weather',
    mimeType: 'application/json',
    tags: [],
    discoverable: false,
    inputSchema: null,
    outputSchema: null,
    ...overrides,
  };
}

export function x402Config(overrides: Partial<X402Config> = {}): X402Config {
  return {
    account: {
      id: 'acc-1',
      name: 'Main',
      serviceName: 'Weather API',
      iconUrl: 'https://cdn.example.com/icon.png',
      status: 'active',
    },
    environment: 'sandbox',
    network: 'eip155:84532',
    payTo: { mode: 'wallet', address: PAY_TO },
    networks: [{ network: BASE_SEPOLIA, payTo: { mode: 'wallet', address: PAY_TO } }],
    assets: [
      {
        symbol: 'USDC',
        currencyCode: 'USDC_BASE',
        address: USDC,
        decimals: 6,
        methods: ['eip3009', 'permit2'],
        minAmount: '1000',
        network: BASE_SEPOLIA,
        payTo: PAY_TO,
        eip712: { name: 'USDC', version: '2' },
      },
      {
        symbol: 'TKN',
        currencyCode: 'TKN_BASE',
        address: PERMIT2_TOKEN,
        decimals: 18,
        methods: ['permit2'],
        minAmount: '1',
        network: BASE_SEPOLIA,
        payTo: PAY_TO,
        eip712: { name: 'Token', version: '1' },
      },
    ],
    resources: [resource()],
    fees: { enabled: false },
    limits: { dailyGasUsd: 1 },
    ...overrides,
  };
}

/** A config whose `path` is priced in USDC and in the Permit2-only token, in that order. */
export function twoPriceConfig(path: string): X402Config {
  return x402Config({
    resources: [
      resource({
        path,
        prices: [
          { amount: '1000', asset: USDC, currencyCode: 'USDC_BASE', network: BASE_SEPOLIA },
          { amount: '5', asset: PERMIT2_TOKEN, currencyCode: 'TKN_BASE', network: BASE_SEPOLIA },
        ],
      }),
    ],
  });
}
