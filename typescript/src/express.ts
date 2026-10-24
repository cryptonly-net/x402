import type { NextFunction, Request, Response } from 'express';
import type { RoutesConfig } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import {
  paymentMiddleware,
  x402ResourceServer,
  type PaywallConfig,
  type SchemeNetworkServer,
} from '@x402/express';
import { CryptonlyFacilitatorClient, type CryptonlyFacilitatorConfig } from './client.js';
import {
  fetchX402Config,
  isSolanaNetwork,
  routesFromConfig,
  type X402Config,
  type X402ExtensionsModule,
} from './config.js';

/** An Express middleware. */
export type ExpressMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

/** What {@link InnerMiddlewareFactory} gets besides the routes. */
export type InnerMiddlewareContext = {
  config: X402Config;
  facilitator: CryptonlyFacilitatorClient;
  /** Registered on the account's EVM network. */
  schemes: readonly SchemeNetworkServer[];
  /** Registered on each Solana network of the account. */
  svmSchemes: readonly SchemeNetworkServer[];
  paywallConfig?: PaywallConfig;
};

/**
 * Builds the payment middleware for one set of routes. The default is the
 * stock `paymentMiddleware` from `@x402/express` over a fresh
 * `x402ResourceServer`; replace it to add hooks, or in tests.
 */
export type InnerMiddlewareFactory = (
  routes: RoutesConfig,
  context: InnerMiddlewareContext,
) => ExpressMiddleware;

/** Logger used for refresh failures and skipped resources. */
export type CryptonlyMiddlewareLogger = Pick<Console, 'info' | 'warn' | 'error'>;

/** Options for {@link cryptonlyPaymentMiddleware}. */
export type CryptonlyPaymentMiddlewareOptions = CryptonlyFacilitatorConfig & {
  /**
   * How often to reload `GET /x402/config`. Defaults to 60 s; `0` turns
   * refreshing off.
   */
  refreshIntervalMs?: number;
  /**
   * Scheme servers registered on the account's network. Defaults to
   * `[new ExactEvmScheme()]`. Resources with another scheme are skipped.
   */
  schemes?: readonly SchemeNetworkServer[];
  /**
   * Scheme servers registered on the account's Solana networks. Defaults
   * to `[new ExactSvmScheme()]` from `@x402/svm` when it is installed, and
   * to none otherwise (Solana resources are then skipped).
   */
  svmSchemes?: readonly SchemeNetworkServer[];
  /** Passed to the stock `paymentMiddleware` for the browser paywall. */
  paywallConfig?: PaywallConfig;
  /** `fetch` for `GET /x402/config`. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * After a failed first load, how long requests answer 503 before the
   * next attempt. Defaults to 5 s.
   */
  retryAfterMs?: number;
  /** Defaults to `console`. */
  logger?: CryptonlyMiddlewareLogger;
  /** `@x402/extensions` override; `null` leaves extensions out. */
  extensions?: X402ExtensionsModule | null;
  /** Builds the inner middleware. See {@link InnerMiddlewareFactory}. */
  createMiddleware?: InnerMiddlewareFactory;
};

/** The middleware returned by {@link cryptonlyPaymentMiddleware}. */
export type CryptonlyPaymentMiddleware = ((
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>) & {
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
  /** Stops refreshing. The last routes stay in use. */
  close(): void;
};

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const LOG_PREFIX = '[@cryptonly/x402]';

/** The default {@link InnerMiddlewareFactory}: stock `@x402/express`. */
export const stockPaymentMiddleware: InnerMiddlewareFactory = (
  routes,
  { config, facilitator, schemes, svmSchemes, paywallConfig },
) => {
  // A fresh resource server per route set: `initialize()` on a shared one
  // would clear its facilitator data under requests still in flight.
  const server = new x402ResourceServer(facilitator);
  for (const scheme of schemes) {
    server.register(config.network, scheme);
  }
  for (const network of solanaNetworksOf(config)) {
    for (const scheme of svmSchemes) {
      server.register(network, scheme);
    }
  }
  return paymentMiddleware(routes, server, paywallConfig);
};

function solanaNetworksOf(config: X402Config): X402Config['network'][] {
  const networks = new Set<X402Config['network']>();
  for (const entry of config.networks ?? []) {
    if (isSolanaNetwork(entry.network)) networks.add(entry.network);
  }
  for (const asset of config.assets) {
    if (asset.network && isSolanaNetwork(asset.network)) networks.add(asset.network);
  }
  return [...networks];
}

type SvmServerModule = { ExactSvmScheme: new () => SchemeNetworkServer };
let svmModule: SvmServerModule | null | undefined;

/** `@x402/svm`'s exact server scheme when installed (optional peer). */
function defaultSvmSchemes(): SchemeNetworkServer[] {
  if (svmModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      svmModule = require('@x402/svm/exact/server') as SvmServerModule;
    } catch {
      svmModule = null;
    }
  }
  return svmModule ? [new svmModule.ExactSvmScheme()] : [];
}

/**
 * Express middleware whose paid routes and prices come from the Cryptonly
 * dashboard (`GET /x402/config`), refreshed every minute, so a price change
 * reaches production without a deploy.
 *
 * - The configuration loads on the first request (or on `ready()`), once.
 * - Each refresh rebuilds the stock `@x402/express` middleware only when the
 *   routes changed. A failed refresh keeps the last good routes.
 * - Until a first load succeeds, every request through it answers 503
 *   (fail closed): paid endpoints are never served for free. Mount it after
 *   health checks and other free routes.
 *
 * @example
 * ```ts
 * import { cryptonlyPaymentMiddleware } from '@cryptonly/x402/express';
 *
 * app.use(cryptonlyPaymentMiddleware({ apiKey: process.env.CRYPTONLY_API_KEY! }));
 * app.get('/weather', (req, res) => res.json({ temperatureC: 21 }));
 * ```
 */
export function cryptonlyPaymentMiddleware(
  options: CryptonlyPaymentMiddlewareOptions,
): CryptonlyPaymentMiddleware {
  const facilitator = new CryptonlyFacilitatorClient(options);
  const schemes = options.schemes ?? [new ExactEvmScheme()];
  const svmSchemes = options.svmSchemes ?? defaultSvmSchemes();
  const createMiddleware = options.createMiddleware ?? stockPaymentMiddleware;
  const logger = options.logger ?? console;
  const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const retryAfterMs = options.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;

  let current:
    | { key: string; routes: RoutesConfig; handler: ExpressMiddleware }
    | undefined;
  let inflight: Promise<boolean> | undefined;
  let firstLoad: Promise<void> | undefined;
  let lastFailureAt: number | undefined;
  let lastFailure: unknown;
  let timer: ReturnType<typeof setInterval> | undefined;
  let started = false;
  let closed = false;

  async function load(): Promise<boolean> {
    const config = await fetchX402Config({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      sandbox: options.sandbox,
      fetch: options.fetch,
    });
    const skipped: string[] = [];
    // A route is servable when a scheme is registered for its network.
    const evmNames = schemes.map((scheme) => scheme.scheme);
    const svmNames = svmSchemes.map((scheme) => scheme.scheme);
    const routes = routesFromConfig(config, {
      schemes: [...new Set([...evmNames, ...svmNames])],
      ...(options.extensions !== undefined ? { extensions: options.extensions } : {}),
      onSkip: (resource, reason) =>
        skipped.push(`${resource.method} ${resource.path}: ${reason}`),
    });
    for (const [key, route] of Object.entries(routes)) {
      const accepts = Array.isArray(route.accepts) ? route.accepts[0] : route.accepts;
      const names = isSolanaNetwork(accepts.network) ? svmNames : evmNames;
      if (!names.includes(accepts.scheme)) {
        skipped.push(`${key}: no ${accepts.scheme} scheme for ${accepts.network}`);
        delete routes[key];
      }
    }
    const key = JSON.stringify([config.network, routes]);
    if (current?.key === key) return false;

    for (const line of skipped) logger.warn(`${LOG_PREFIX} skipped ${line}`);
    const handler = createMiddleware(routes, {
      config,
      facilitator,
      schemes,
      svmSchemes,
      ...(options.paywallConfig ? { paywallConfig: options.paywallConfig } : {}),
    });
    const previous = current;
    current = { key, routes, handler };
    if (previous) {
      logger.info(
        `${LOG_PREFIX} x402 routes updated: ${Object.keys(routes).join(', ') || '(none)'}`,
      );
    }
    return true;
  }

  function refresh(): Promise<boolean> {
    inflight ??= load().finally(() => {
      inflight = undefined;
    });
    return inflight;
  }

  function startRefreshing(): void {
    if (started || closed) return;
    started = true;
    if (!(refreshIntervalMs > 0) || !Number.isFinite(refreshIntervalMs)) return;
    timer = setInterval(() => {
      refresh().catch((error: unknown) => {
        logger.warn(
          current
            ? `${LOG_PREFIX} config refresh failed; keeping the last routes: ${describe(error)}`
            : `${LOG_PREFIX} config load failed: ${describe(error)}`,
        );
      });
    }, refreshIntervalMs);
    timer.unref?.();
  }

  function ready(): Promise<void> {
    startRefreshing();
    if (current) return Promise.resolve();
    if (!firstLoad) {
      if (lastFailureAt !== undefined && Date.now() - lastFailureAt < retryAfterMs) {
        return Promise.reject(lastFailure);
      }
      firstLoad = refresh().then(
        () => {
          firstLoad = undefined;
        },
        (error: unknown) => {
          firstLoad = undefined;
          lastFailureAt = Date.now();
          lastFailure = error;
          logger.error(`${LOG_PREFIX} x402 config unavailable: ${describe(error)}`);
          throw error;
        },
      );
    }
    return firstLoad;
  }

  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    if (!current) {
      try {
        await ready();
      } catch {
        if (!res.headersSent) {
          res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
          res.status(503).json({
            error: 'x402_config_unavailable',
            message: 'Payment configuration is unavailable; retry shortly.',
          });
        }
        return;
      }
    }
    await current!.handler(req, res, next);
  };

  return Object.assign(middleware, {
    ready,
    refresh: () => {
      startRefreshing();
      return refresh();
    },
    routes: () => current?.routes,
    close: () => {
      closed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { fetchX402Config, routesFromConfig } from './config.js';
export type { X402Config } from './config.js';
