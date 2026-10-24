import { x402HTTPResourceServer, x402ResourceServer, type HTTPAdapter } from '@x402/core/server';
import { createHTTPResourceServer, createPublicRequestMapper } from './public-url.js';

/** An adapter for `GET <url>`, as a framework would build it. */
function adapter(url: string): HTTPAdapter {
  const parsed = new URL(url);
  return {
    getHeader: () => undefined,
    getMethod: () => 'GET',
    getPath: () => parsed.pathname,
    getUrl: () => url,
    getAcceptHeader: () => 'application/json',
    getUserAgent: () => 'jest',
    getQueryParams: () => Object.fromEntries(parsed.searchParams),
  };
}

function context(url: string) {
  const path = new URL(url).pathname;
  return { adapter: adapter(url), path, decodedPath: decodeURIComponent(path), method: 'GET' };
}

describe('createPublicRequestMapper', () => {
  it('maps nothing when the app is served at its public URL', () => {
    expect(createPublicRequestMapper({})).toBeUndefined();
    expect(createPublicRequestMapper({ pathPrefix: '/' })).toBeUndefined();
  });

  it('adds the prefix a proxy strips, to the path and the URL', () => {
    const toPublic = createPublicRequestMapper({ pathPrefix: '/v1/' })!;
    const mapped = toPublic(context('http://10.0.0.5:3000/weather/s%C3%A3o?units=c'));

    expect(mapped.path).toBe('/v1/weather/s%C3%A3o');
    expect(mapped.decodedPath).toBe('/v1/weather/são');
    expect(mapped.adapter.getPath()).toBe('/v1/weather/s%C3%A3o');
    expect(mapped.adapter.getUrl()).toBe('http://10.0.0.5:3000/v1/weather/s%C3%A3o?units=c');
    expect(mapped.adapter.getQueryParams?.()).toEqual({ units: 'c' });
    expect(toPublic(context('http://10.0.0.5:3000/')).path).toBe('/v1');
  });

  it('maps with a function, given the path and the request', () => {
    const publicPath = jest.fn((path: string) => path.replace(/^\/internal/, ''));
    const toPublic = createPublicRequestMapper({ publicPath })!;
    const original = context('http://api.internal/internal/weather/lisbon');

    const mapped = toPublic(original);

    expect(mapped.path).toBe('/weather/lisbon');
    expect(mapped.adapter.getUrl()).toBe('http://api.internal/weather/lisbon');
    expect(publicPath).toHaveBeenCalledWith('/internal/weather/lisbon', original.adapter);
  });

  it('builds the URL on the public origin', () => {
    const toPublic = createPublicRequestMapper({
      pathPrefix: '/v1',
      publicBaseUrl: 'https://api.example.com/',
    })!;

    const mapped = toPublic(context('http://10.0.0.5:3000/weather/lisbon?units=c'));

    expect(mapped.adapter.getUrl()).toBe('https://api.example.com/v1/weather/lisbon?units=c');
  });

  it('maps a context once', () => {
    const toPublic = createPublicRequestMapper({ pathPrefix: '/v1' })!;
    const once = toPublic(context('http://localhost/weather'));
    expect(toPublic(once)).toBe(once);
    expect(toPublic(once).path).toBe('/v1/weather');
  });

  it.each([
    [{ pathPrefix: '/v1', publicPath: (path: string) => path }, 'not both'],
    [{ pathPrefix: 'v1' }, 'pathPrefix must be a path'],
    [{ publicBaseUrl: 'api.example.com' }, 'must be an absolute URL'],
    [{ publicBaseUrl: 'https://api.example.com/v1' }, 'put a path in pathPrefix'],
    [{ publicBaseUrl: 'ftp://api.example.com' }, 'http(s) origin'],
  ])('rejects %j', (options, message) => {
    expect(() => createPublicRequestMapper(options)).toThrow(message);
  });
});

describe('createHTTPResourceServer', () => {
  const routes = {
    'GET /v1/weather/:city': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:84532' as const,
        payTo: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        price: '$0.01',
      },
    },
  };
  const resourceServer = new x402ResourceServer();

  it('matches dashboard paths as the app sees them, without a mapper', () => {
    const server = createHTTPResourceServer(resourceServer, routes);
    expect(server).toBeInstanceOf(x402HTTPResourceServer);
    expect(server.requiresPayment(context('http://localhost/weather/lisbon'))).toBe(false);
    expect(server.requiresPayment(context('http://localhost/v1/weather/lisbon'))).toBe(true);
  });

  it('matches dashboard paths on the public path, with a mapper', () => {
    const server = createHTTPResourceServer(
      resourceServer,
      routes,
      createPublicRequestMapper({ pathPrefix: '/v1' }),
    );
    expect(server).toBeInstanceOf(x402HTTPResourceServer);
    expect(server.requiresPayment(context('http://localhost/weather/lisbon'))).toBe(true);
    expect(server.requiresPayment(context('http://localhost/other'))).toBe(false);
  });
});
