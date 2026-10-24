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

  it('uses an explicit baseUrl over sandbox, without trailing slashes', () => {
    const client = new CryptonlyFacilitatorClient({
      apiKey: 'k',
      baseUrl: 'http://localhost:8001//',
      sandbox: true,
    });
    expect(client.url).toBe('http://localhost:8001/x402');
  });

  it('sends the api key on verify, settle, supported and bazaar', async () => {
    const client = new CryptonlyFacilitatorClient({ apiKey: 'k' });
    const headers = { [MERCHANT_API_KEY_HEADER]: 'k' };
    await expect(client.createAuthHeaders('verify')).resolves.toEqual({
      headers,
    });
    await expect(client.createAuthHeaders('supported')).resolves.toEqual({
      headers,
    });
    await expect(client.createAuthHeaders('bazaar')).resolves.toEqual({
      headers,
    });
  });
});
