import type { NextFunction, Request, Response } from 'express';
import type { RoutesConfig } from '@x402/core/server';
import type { SchemeNetworkServer } from '@x402/core/types';
import { paymentMiddlewareFromHTTPServer, type PaywallConfig } from '@x402/express';
import {
  X402_CONFIG_UNAVAILABLE,
  createHTTPResourceServer,
  createPublicRequestMapper,
  createResourceServer,
  createX402RouteSource,
  type CryptonlyFacilitatorClient,
  type X402Config,
  type X402Logger,
  type X402PublicRequestMapper,
  type X402RouteSource,
  type X402RouteSourceOptions,
} from '@cryptonly/x402';

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
  /** Maps requests to their public URL; set with `pathPrefix`, `publicPath` or `publicBaseUrl`. */
  publicRequest?: X402PublicRequestMapper;
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
export type CryptonlyMiddlewareLogger = X402Logger;

/** Options for {@link cryptonlyPaymentMiddleware}. */
export type CryptonlyPaymentMiddlewareOptions = X402RouteSourceOptions & {
  /** Passed to the stock `paymentMiddleware` for the browser paywall. */
  paywallConfig?: PaywallConfig;
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

/** The default {@link InnerMiddlewareFactory}: stock `@x402/express`. */
export const stockPaymentMiddleware: InnerMiddlewareFactory = (
  routes,
  { config, facilitator, schemes, svmSchemes, paywallConfig, publicRequest },
) =>
  paymentMiddlewareFromHTTPServer(
    createHTTPResourceServer(
      createResourceServer(config, facilitator, schemes, svmSchemes),
      routes,
      publicRequest,
    ),
    paywallConfig,
  );

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
 * import { cryptonlyPaymentMiddleware } from '@cryptonly/x402-express';
 *
 * app.use(cryptonlyPaymentMiddleware({ apiKey: process.env.CRYPTONLY_API_KEY! }));
 * app.get('/weather', (req, res) => res.json({ temperatureC: 21 }));
 * ```
 */
export function cryptonlyPaymentMiddleware(
  options: CryptonlyPaymentMiddlewareOptions,
): CryptonlyPaymentMiddleware {
  const createMiddleware = options.createMiddleware ?? stockPaymentMiddleware;
  const publicRequest = createPublicRequestMapper(options);
  const source: X402RouteSource<ExpressMiddleware> = createX402RouteSource(
    options,
    (routes, config) =>
      createMiddleware(routes, {
        config,
        facilitator: source.facilitator,
        schemes: source.schemes,
        svmSchemes: source.svmSchemes,
        ...(options.paywallConfig ? { paywallConfig: options.paywallConfig } : {}),
        ...(publicRequest ? { publicRequest } : {}),
      }),
  );

  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    if (!source.current()) {
      try {
        await source.ready();
      } catch {
        if (!res.headersSent) {
          res.setHeader('Retry-After', String(Math.ceil(source.retryAfterMs / 1000)));
          res.status(503).json(X402_CONFIG_UNAVAILABLE);
        }
        return;
      }
    }
    await source.current()!.value(req, res, next);
  };

  return Object.assign(middleware, {
    ready: source.ready,
    refresh: source.refresh,
    routes: () => source.current()?.routes,
    close: source.close,
  });
}

export { fetchX402Config, routesFromConfig } from '@cryptonly/x402';
export type { X402Config } from '@cryptonly/x402';
