import { x402ResourceServer, type RoutesConfig } from '@x402/core/server';
import type { SchemeNetworkServer } from '@x402/core/types';
import { CryptonlyFacilitatorClient, type CryptonlyFacilitatorConfig } from './client.js';
import {
  fetchX402Config,
  isSolanaNetwork,
  routesFromConfig,
  type X402Config,
  type X402ExtensionsModule,
} from './config.js';
import { optionalModule } from './optional.js';
import type { X402PublicUrlOptions } from './public-url.js';

/** Logger used for refresh failures and skipped resources. */
export type X402Logger = Pick<Console, 'info' | 'warn' | 'error'>;

/** Options shared by every framework adapter. */
export type X402RouteSourceOptions = CryptonlyFacilitatorConfig & X402PublicUrlOptions & {
  /**
   * How often to reload `GET /x402/config`. Defaults to 60 s; `0` turns
   * refreshing off.
   */
  refreshIntervalMs?: number;
  /**
   * Scheme servers registered on the account's EVM network. Defaults to
   * `[new ExactEvmScheme()]` from `@x402/evm`. Resources with another scheme
   * are skipped.
   */
  schemes?: readonly SchemeNetworkServer[];
  /**
   * Scheme servers registered on the account's Solana networks. Defaults
   * to `[new ExactSvmScheme()]` from `@x402/svm` when it is installed, and
   * to none otherwise (Solana resources are then skipped).
   */
  svmSchemes?: readonly SchemeNetworkServer[];
  /** `fetch` for `GET /x402/config`. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * After a failed first load, how long requests answer 503 before the
   * next attempt. Defaults to 5 s.
   */
  retryAfterMs?: number;
  /** Defaults to `console`. */
  logger?: X402Logger;
  /** `@x402/extensions` override; `null` leaves extensions out. */
  extensions?: X402ExtensionsModule | null;
};

/** One loaded configuration, its routes and what the adapter built for them. */
export type X402RouteSet<T> = {
  config: X402Config;
  routes: RoutesConfig;
  /** Identity of the routes: equal keys mean nothing to rebuild. */
  key: string;
  /** What the adapter's `build` returned for these routes. */
  value: T;
};

/** The dashboard routes, kept fresh. See {@link createX402RouteSource}. */
export type X402RouteSource<T> = {
  readonly facilitator: CryptonlyFacilitatorClient;
  /** Scheme servers in use on the EVM network. */
  readonly schemes: readonly SchemeNetworkServer[];
  /** Scheme servers in use on the Solana networks. */
  readonly svmSchemes: readonly SchemeNetworkServer[];
  /** For `Retry-After` while the configuration is unavailable. */
  readonly retryAfterMs: number;
  readonly logger: X402Logger;
  /** The route set in use, or `undefined` before the first successful load. */
  current(): X402RouteSet<T> | undefined;
  /**
   * Loads the configuration now (if not loaded yet) and starts refreshing.
   * Rejects when the first load fails; within `retryAfterMs` of a failure
   * it rejects again without a new attempt.
   */
  ready(): Promise<void>;
  /** Reloads the configuration now. Resolves `true` when the routes changed. */
  refresh(): Promise<boolean>;
  /** Stops refreshing. The last routes stay in use. */
  close(): void;
};

/** Builds what an adapter serves for one set of routes. Throwing keeps the last set. */
export type X402RouteSetBuilder<T> = (routes: RoutesConfig, config: X402Config) => T;

/** Body of the `503` answered while the configuration is unavailable. */
export const X402_CONFIG_UNAVAILABLE = {
  error: 'x402_config_unavailable',
  message: 'Payment configuration is unavailable; retry shortly.',
} as const;

/** Prefix of every log line the packages write. */
export const X402_LOG_PREFIX = '[@cryptonly/x402]';

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_RETRY_AFTER_MS = 5_000;

/**
 * Loads the paid routes from the Cryptonly dashboard (`GET /x402/config`)
 * and refreshes them every minute. The framework adapters share it.
 *
 * - The configuration loads on {@link X402RouteSource.ready}, once.
 * - Each refresh calls `build` only when the routes changed. A failed
 *   refresh, or a `build` that throws, keeps the last good set.
 */
export function createX402RouteSource<T>(
  options: X402RouteSourceOptions,
  build: X402RouteSetBuilder<T>,
): X402RouteSource<T> {
  const facilitator = new CryptonlyFacilitatorClient(options);
  const schemes = options.schemes ?? defaultEvmSchemes();
  const svmSchemes = options.svmSchemes ?? defaultSvmSchemes();
  const logger = options.logger ?? console;
  const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const retryAfterMs = options.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;

  let current: X402RouteSet<T> | undefined;
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
    // Every option must have one: core refuses the whole server otherwise.
    for (const [key, route] of Object.entries(routes)) {
      const options = Array.isArray(route.accepts) ? route.accepts : [route.accepts];
      const servable = options.filter((option) => {
        const names = isSolanaNetwork(option.network) ? svmNames : evmNames;
        if (names.includes(option.scheme)) return true;
        skipped.push(`${key}: no ${option.scheme} scheme for ${option.network}`);
        return false;
      });
      if (servable.length === 0) delete routes[key];
      else route.accepts = servable;
    }
    const key = JSON.stringify([config.network, routes]);
    if (current?.key === key) return false;

    for (const line of skipped) logger.warn(`${X402_LOG_PREFIX} skipped ${line}`);
    const value = build(routes, config);
    const previous = current;
    current = { config, routes, key, value };
    if (previous) {
      logger.info(
        `${X402_LOG_PREFIX} x402 routes updated: ${Object.keys(routes).join(', ') || '(none)'}`,
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
            ? `${X402_LOG_PREFIX} config refresh failed; keeping the last routes: ${describeError(error)}`
            : `${X402_LOG_PREFIX} config load failed: ${describeError(error)}`,
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
          logger.error(`${X402_LOG_PREFIX} x402 config unavailable: ${describeError(error)}`);
          throw error;
        },
      );
    }
    return firstLoad;
  }

  return {
    facilitator,
    schemes,
    svmSchemes,
    retryAfterMs,
    logger,
    current: () => current,
    ready,
    refresh: () => {
      startRefreshing();
      return refresh();
    },
    close: () => {
      closed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

/**
 * A fresh `x402ResourceServer` on the facilitator, with the EVM schemes
 * registered on each of the account's EVM networks and the SVM schemes on
 * each of its Solana networks.
 *
 * Build one per route set: `initialize()` on a shared one would clear its
 * facilitator data under requests still in flight.
 */
export function createResourceServer(
  config: X402Config,
  facilitator: CryptonlyFacilitatorClient,
  schemes: readonly SchemeNetworkServer[],
  svmSchemes: readonly SchemeNetworkServer[],
): x402ResourceServer {
  const server = new x402ResourceServer(facilitator);
  for (const network of evmNetworksOf(config)) {
    for (const scheme of schemes) {
      server.register(network, scheme);
    }
  }
  for (const network of solanaNetworksOf(config)) {
    for (const scheme of svmSchemes) {
      server.register(network, scheme);
    }
  }
  return server;
}

/** Every network the account lists, itself or through an asset. */
function networksOf(config: X402Config): Set<X402Config['network']> {
  const networks = new Set<X402Config['network']>([config.network]);
  for (const entry of config.networks) networks.add(entry.network);
  for (const asset of config.assets) networks.add(asset.network);
  return networks;
}

/** The EVM networks an account accepts payments on; Base first. */
export function evmNetworksOf(config: X402Config): X402Config['network'][] {
  return [...networksOf(config)].filter((network) => !isSolanaNetwork(network));
}

/** The Solana networks an account accepts payments on. */
export function solanaNetworksOf(config: X402Config): X402Config['network'][] {
  return [...networksOf(config)].filter(isSolanaNetwork);
}

type SchemeModule = { [name: string]: new () => SchemeNetworkServer };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadEvm = optionalModule<SchemeModule>(() => require('@x402/evm/exact/server'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadSvm = optionalModule<SchemeModule>(() => require('@x402/svm/exact/server'));

/** `[new ExactEvmScheme()]` from `@x402/evm`. Throws when it is not installed. */
export function defaultEvmSchemes(): SchemeNetworkServer[] {
  const evmModule = loadEvm();
  if (!evmModule) {
    throw new TypeError(
      `${X402_LOG_PREFIX} @x402/evm is not installed; install it or pass \`schemes\``,
    );
  }
  return [new evmModule.ExactEvmScheme()];
}

/** `[new ExactSvmScheme()]` from `@x402/svm` when installed (optional peer), else none. */
export function defaultSvmSchemes(): SchemeNetworkServer[] {
  const svmModule = loadSvm();
  return svmModule ? [new svmModule.ExactSvmScheme()] : [];
}

/** An error's message, for log lines. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
