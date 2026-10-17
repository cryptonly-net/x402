import { CryptonlyFacilitatorClient } from './client.js';
import {
  MERCHANT_API_BASE_URL,
  MERCHANT_API_KEY_HEADER,
  SANDBOX_MERCHANT_API_BASE_URL,
} from './constants.js';

describe('CryptonlyFacilitatorClient', () => {
  it('requires an api key', () => {
    expect(() => new CryptonlyFacilitatorClient({ apiKey: '' })).toThrow(
      new TypeError('CryptonlyFacilitatorClient: `apiKey` is required'),
    );
  });

  it('points at production by default and sandbox when asked', async () => {
    const production = new CryptonlyFacilitatorClient({ apiKey: 'k' });
    expect(production.url).toBe(`${MERCHANT_API_BASE_URL}/x402`);

    const sandbox = new CryptonlyFacilitatorClient({
      apiKey: 'k',
      sandbox: true,
    });
    expect(sandbox.url).toBe(`${SANDBOX_MERCHANT_API_BASE_URL}/x402`);

    const headers = await sandbox.createAuthHeaders('settle');
    expect(headers).toEqual({
      headers: { [MERCHANT_API_KEY_HEADER]: 'k' },
    });
  });
});
