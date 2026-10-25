import {
  x402HTTPResourceServer,
  type HTTPAdapter,
  type HTTPRequestContext,
  type HTTPTransportContext,
  type PaywallConfig,
  type RoutesConfig,
  type x402ResourceServer,
} from '@x402/core/server';
import { registerBazaar } from './bazaar.js';

/**
 * Where the app sits behind a reverse proxy that rewrites its URLs. Dashboard
 * prices are keyed by the public path, so the path the app sees is mapped to
 * it before matching.
 */
export type X402PublicUrlOptions = {
  /**
   * Prefix the proxy strips before the request reaches the app: the public
   * path is `pathPrefix` + the app's path. `/v1` when the proxy serves the
   * public `/v1/weather` from the app's `/weather`.
   */
  pathPrefix?: string;
  /**
   * Maps the path the app sees to the public path, for other rewrites. A
   * proxy that adds `/internal`: `(path) => path.replace(/^\/internal/, '')`.
   * Not together with `pathPrefix`.
   */
  publicPath?: (path: string, request: HTTPAdapter) => string;
  /**
   * Public origin buyers call (`https://api.example.com`). The 402's
   * `resource.url` is built from it, else from the request's own host and
   * protocol.
   */
  publicBaseUrl?: string;
};

/** Maps a request context to its public path and URL. Mapping twice is a no-op. */
export type X402PublicRequestMapper = (context: HTTPRequestContext) => HTTPRequestContext;

const MAPPED = Symbol('cryptonly.x402.publicRequest');

/**
 * The mapper for `options`, or `undefined` when the app is served at its
 * public URL. Throws on invalid options, so call it at startup.
 */
export function createPublicRequestMapper(
  options: X402PublicUrlOptions,
): X402PublicRequestMapper | undefined {
  const { pathPrefix, publicPath, publicBaseUrl } = options;
  if (pathPrefix !== undefined && publicPath) {
    throw new Error('[@cryptonly/x402] set either `pathPrefix` or `publicPath`, not both');
  }
  const prefix = pathPrefix === undefined ? undefined : normalizePrefix(pathPrefix);
  const origin = publicBaseUrl === undefined ? undefined : originOf(publicBaseUrl);
  if (!prefix && !publicPath && !origin) return undefined;

  const toPublic = (path: string, adapter: HTTPAdapter): string => {
    if (prefix) return path === '/' ? prefix : `${prefix}${path}`;
    if (!publicPath) return path;
    const mapped = publicPath(path, adapter);
    return mapped.startsWith('/') ? mapped : `/${mapped}`;
  };

  return (context) => {
    if ((context as { [MAPPED]?: true })[MAPPED]) return context;
    const inner = context.adapter;
    const path = toPublic(context.path, inner);
    const adapter = withPublicUrl(inner, path, origin);
    return Object.assign(
      {
        ...context,
        adapter,
        path,
        ...(context.decodedPath === undefined
          ? {}
          : { decodedPath: toPublic(context.decodedPath, inner) }),
      },
      { [MAPPED]: true as const },
    );
  };
}

/**
 * An `x402HTTPResourceServer` that matches routes and builds `resource.url`
 * on the public URL. For middleware that builds the request context itself
 * (the stock Express and Fastify ones).
 */
class PublicUrlHTTPResourceServer extends x402HTTPResourceServer {
  constructor(
    resourceServer: x402ResourceServer,
    routes: RoutesConfig,
    private readonly toPublic: X402PublicRequestMapper,
  ) {
    super(resourceServer, routes);
  }

  override requiresPayment(context: HTTPRequestContext): boolean {
    return super.requiresPayment(this.toPublic(context));
  }

  override processHTTPRequest(context: HTTPRequestContext, paywallConfig?: PaywallConfig) {
    return super.processHTTPRequest(this.toPublic(context), paywallConfig);
  }

  override processSettlement(
    ...args: Parameters<x402HTTPResourceServer['processSettlement']>
  ): ReturnType<x402HTTPResourceServer['processSettlement']> {
    const [payload, requirements, extensions, transport, ...rest] = args;
    return super.processSettlement(
      payload,
      requirements,
      extensions,
      transport && this.publicTransport(transport),
      ...rest,
    );
  }

  private publicTransport(transport: HTTPTransportContext): HTTPTransportContext {
    return { ...transport, request: this.toPublic(transport.request) };
  }
}

/**
 * An `x402HTTPResourceServer` for `routes`, on the public URL when `toPublic`
 * is given, with the bazaar extension registered when the routes declare it.
 */
export function createHTTPResourceServer(
  resourceServer: x402ResourceServer,
  routes: RoutesConfig,
  toPublic?: X402PublicRequestMapper,
): x402HTTPResourceServer {
  registerBazaar(resourceServer, routes);
  return toPublic
    ? new PublicUrlHTTPResourceServer(resourceServer, routes, toPublic)
    : new x402HTTPResourceServer(resourceServer, routes);
}

function normalizePrefix(prefix: string): string | undefined {
  if (!prefix.startsWith('/') || /[?#]/.test(prefix)) {
    throw new Error(`[@cryptonly/x402] pathPrefix must be a path like "/v1", got "${prefix}"`);
  }
  const trimmed = prefix.replace(/\/+$/, '');
  return trimmed === '' ? undefined : trimmed;
}

function originOf(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`[@cryptonly/x402] publicBaseUrl must be an absolute URL, got "${baseUrl}"`);
  }
  if (!/^https?:$/.test(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      `[@cryptonly/x402] publicBaseUrl must be an http(s) origin like "https://api.example.com" ` +
        `(put a path in pathPrefix), got "${baseUrl}"`,
    );
  }
  return url.origin;
}

/** `inner`, answering with the public path and URL. */
function withPublicUrl(inner: HTTPAdapter, path: string, origin: string | undefined): HTTPAdapter {
  const getUrl = () => {
    const own = inner.getUrl();
    let url: URL;
    try {
      url = new URL(own);
    } catch {
      return origin ? `${origin}${path}` : own;
    }
    return `${origin ?? url.origin}${path}${url.search}`;
  };
  return new Proxy(inner, {
    get(target, property, receiver) {
      if (property === 'getPath') return () => path;
      if (property === 'getUrl') return getUrl;
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
