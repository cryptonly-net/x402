import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';
import type { RoutesConfig, x402HTTPResourceServer } from '@x402/core/server';
import { paymentMiddlewareFromHTTPServer, type PaywallConfig } from '@x402/fastify';
import {
  X402_CONFIG_UNAVAILABLE,
  createHTTPResourceServer,
  createPublicRequestMapper,
  createResourceServer,
  createX402RouteSource,
  type X402RouteSource,
  type X402RouteSourceOptions,
} from '@cryptonly/x402';

/** Options for {@link cryptonlyPayments}. */
export type CryptonlyPaymentsOptions = X402RouteSourceOptions & {
  /** Passed to the stock `@x402/fastify` hooks for the browser paywall. */
  paywallConfig?: PaywallConfig;
};

/** What {@link cryptonlyPayments} decorates the instance with, as `app.cryptonlyX402`. */
export type CryptonlyX402 = {
  /**
   * Loads the configuration now (if not loaded yet) and starts refreshing.
   * Rejects when the first load fails. Await it before `listen` to fail
   * fast at startup.
   */
  ready(): Promise<void>;
  /** Reloads the configuration now. Resolves `true` when the routes changed. */
  refresh(): Promise<boolean>;
  /** The routes in use, or `undefined` before the first successful load. */
  routes(): RoutesConfig | undefined;
  /** Stops refreshing. The last routes stay in use. Called on `app.close()`. */
  close(): void;
};

declare module 'fastify' {
  interface FastifyInstance {
    cryptonlyX402: CryptonlyX402;
  }
}

type OnRequest = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
type OnSend = (request: FastifyRequest, reply: FastifyReply, payload: unknown) => Promise<unknown>;
type OnError = (request: FastifyRequest, reply: FastifyReply, error: Error) => Promise<void>;

/** The stock `@x402/fastify` hooks for one set of routes. */
type HookSet = { onRequest: OnRequest; onSend: OnSend; onError: OnError };

const HOOKS = Symbol('cryptonlyX402Hooks');
type PinnedRequest = FastifyRequest & { [HOOKS]?: HookSet };

/**
 * Runs the stock `paymentMiddlewareFromHTTPServer` against a stand-in
 * instance and keeps the hooks it adds. They keep their per-request state on
 * the request, so the real hooks can hand each request to the set in use.
 */
function stockHooks(httpServer: x402HTTPResourceServer, paywallConfig?: PaywallConfig): HookSet {
  const hooks: Partial<HookSet> = {};
  const capture = {
    decorateRequest: () => capture,
    addHook: (name: keyof HookSet, hook: HookSet[keyof HookSet]) => {
      (hooks as Record<string, unknown>)[name] = hook;
      return capture;
    },
  };
  paymentMiddlewareFromHTTPServer(
    capture as unknown as FastifyInstance,
    httpServer,
    paywallConfig,
  );
  if (!hooks.onRequest || !hooks.onSend || !hooks.onError) {
    throw new Error('@x402/fastify did not register its onRequest, onSend and onError hooks');
  }
  return hooks as HookSet;
}

const plugin: FastifyPluginAsync<CryptonlyPaymentsOptions> = async (app, options) => {
  const publicRequest = createPublicRequestMapper(options);
  const source: X402RouteSource<HookSet> = createX402RouteSource(options, (routes, config) =>
    stockHooks(
      createHTTPResourceServer(
        createResourceServer(config, source.facilitator, source.schemes, source.svmSchemes),
        routes,
        publicRequest,
      ),
      options.paywallConfig,
    ),
  );

  // The stock hooks' per-request state, declared once on the real instance.
  app.decorateRequest('x402Context', undefined);
  app.decorateRequest('x402RawGuard', undefined);
  app.decorate('cryptonlyX402', {
    ready: source.ready,
    refresh: source.refresh,
    routes: () => source.current()?.routes,
    close: source.close,
  } satisfies CryptonlyX402);

  app.addHook('onRequest', async (request: PinnedRequest, reply) => {
    if (!source.current()) {
      try {
        await source.ready();
      } catch {
        reply.header('Retry-After', String(Math.ceil(source.retryAfterMs / 1000)));
        return reply.status(503).send(X402_CONFIG_UNAVAILABLE);
      }
    }
    // Pinned so that a refresh mid-request can't mix two route sets.
    const hooks = source.current()!.value;
    request[HOOKS] = hooks;
    return hooks.onRequest(request, reply);
  });
  app.addHook('onSend', async (request: PinnedRequest, reply, payload) => {
    const hooks = request[HOOKS];
    return hooks ? hooks.onSend(request, reply, payload) : payload;
  });
  app.addHook('onError', async (request: PinnedRequest, reply, error) => {
    await request[HOOKS]?.onError(request, reply, error);
  });
  app.addHook('onClose', async () => {
    source.close();
  });
};

/**
 * Fastify plugin whose paid routes and prices come from the Cryptonly
 * dashboard (`GET /x402/config`), refreshed every minute, so a price change
 * reaches production without a deploy.
 *
 * - The configuration loads on the first request (or on
 *   `app.cryptonlyX402.ready()`), once.
 * - Each refresh rebuilds the stock `@x402/fastify` hooks only when the
 *   routes changed. A failed refresh keeps the last good routes.
 * - Until a first load succeeds, every request in its scope answers 503
 *   (fail closed): paid endpoints are never served for free. Register it in
 *   the scope of the paid routes, or at the root to cover every route.
 *
 * @example
 * ```ts
 * import Fastify from 'fastify';
 * import { cryptonlyPayments } from '@cryptonly/x402-fastify';
 *
 * const app = Fastify();
 * await app.register(cryptonlyPayments, { apiKey: process.env.CRYPTONLY_API_KEY! });
 * app.get('/weather/:city', async (request) => ({ temperatureC: 21 }));
 * ```
 */
export const cryptonlyPayments = fp(plugin, {
  fastify: '5.x',
  name: '@cryptonly/x402-fastify',
});

export { fetchX402Config, routesFromConfig } from '@cryptonly/x402';
export type { X402Config } from '@cryptonly/x402';
