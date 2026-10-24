import {
  Inject,
  Injectable,
  Logger,
  RequestMethod,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  checkIfBazaarNeeded,
  x402HTTPResourceServer,
  x402ResourceServer,
  type RouteConfig,
  type RoutesConfig,
} from '@x402/core/server';
import {
  X402_LOG_PREFIX,
  createResourceServer,
  createX402RouteSource,
  isSolanaNetwork,
  type CryptonlyFacilitatorClient,
  type X402Logger,
  type X402RouteSource,
} from '@cryptonly/x402';
import type { X402RouteMetadata } from './decorators.js';
import { X402_MODULE_OPTIONS, X402_ROUTE_METADATA, type X402ModuleOptions } from './x402.options.js';

/** A resource server ready to process requests for one set of routes. */
export type PreparedServer = {
  readonly httpServer: x402HTTPResourceServer;
  /** Syncs the facilitator's `/supported` once, and the bazaar extension. */
  prepare(): Promise<void>;
  /** The payer the facilitator verified for a payment payload. */
  payerOf(payload: object): string | undefined;
};

/** A handler with `@X402()`, as `METHOD /controller/path`. */
type DecoratedRoute = { method: string; path: string; priceInCode: boolean };

type BazaarModule = {
  bazaarResourceServerExtension: Parameters<x402ResourceServer['registerExtension']>[0];
  validateBazaarRouteExtensions(routes: RoutesConfig): void;
};
let bazaarModule: BazaarModule | null | undefined;

function loadBazaar(): BazaarModule | null {
  if (bazaarModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      bazaarModule = require('@x402/extensions/bazaar') as BazaarModule;
    } catch {
      bazaarModule = null;
    }
  }
  return bazaarModule;
}

/**
 * The dashboard routes of the account, kept fresh, and the resource servers
 * that `@X402()` handlers are paid through.
 */
@Injectable()
export class X402Service implements OnApplicationBootstrap, OnModuleDestroy {
  readonly logger: X402Logger;
  private readonly source: X402RouteSource<PreparedServer>;
  private readonly inCode = new Map<object, PreparedServer>();
  private decorated: DecoratedRoute[] | undefined;
  private readonly warned = new Set<string>();

  constructor(
    @Inject(X402_MODULE_OPTIONS) private readonly options: X402ModuleOptions,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {
    const nest = new Logger('X402');
    this.logger = options.logger ?? {
      info: (message: string) => nest.log(message),
      warn: (message: string) => nest.warn(message),
      error: (message: string) => nest.error(message),
    };
    this.source = createX402RouteSource({ ...options, logger: this.logger }, (routes, config) => {
      const server = this.prepared(
        createResourceServer(
          config,
          this.source.facilitator,
          this.source.schemes,
          this.source.svmSchemes,
        ),
        routes,
      );
      // Sync `/supported` in the background, as the stock middleware does.
      server.prepare().catch(() => {});
      this.checkRoutes(routes);
      return server;
    });
  }

  /** The facilitator client, for calls of your own (`/verify`, `/settle`, discovery). */
  get facilitator(): CryptonlyFacilitatorClient {
    return this.source.facilitator;
  }

  /** For `Retry-After` while the configuration is unavailable. */
  get retryAfterMs(): number {
    return this.source.retryAfterMs;
  }

  /**
   * Loads the dashboard configuration now (if not loaded yet) and starts
   * refreshing. Rejects when the first load fails.
   */
  ready(): Promise<void> {
    return this.source.ready();
  }

  /** Reloads the configuration now. Resolves `true` when the routes changed. */
  refresh(): Promise<boolean> {
    return this.source.refresh();
  }

  /** The dashboard routes in use, or `undefined` before the first successful load. */
  routes(): RoutesConfig | undefined {
    return this.source.current()?.routes;
  }

  async onApplicationBootstrap(): Promise<void> {
    this.decorated = this.discoverDecorated();
    if (this.options.waitForConfig && this.decorated.some((route) => !route.priceInCode)) {
      await this.source.ready();
    }
    const current = this.source.current();
    if (current) this.checkRoutes(current.routes);
  }

  onModuleDestroy(): void {
    this.source.close();
  }

  /** The server for dashboard-priced routes, or `undefined` while the configuration is unavailable. */
  async dashboardServer(): Promise<PreparedServer | undefined> {
    if (!this.source.current()) {
      try {
        await this.source.ready();
      } catch {
        return undefined;
      }
    }
    return this.source.current()?.value;
  }

  /** The server for a handler priced in code, built on first use. */
  inCodeServer(handler: object, route: RouteConfig): PreparedServer {
    let server = this.inCode.get(handler);
    if (!server) {
      const resourceServer = new x402ResourceServer(this.source.facilitator);
      const accepts = Array.isArray(route.accepts) ? route.accepts : [route.accepts];
      for (const network of new Set(accepts.map((option) => option.network))) {
        const schemes = isSolanaNetwork(network) ? this.source.svmSchemes : this.source.schemes;
        for (const scheme of schemes) resourceServer.register(network, scheme);
      }
      server = this.prepared(resourceServer, route);
      this.inCode.set(handler, server);
    }
    return server;
  }

  /** Logs, once per route, that a dashboard-priced handler has no dashboard price. */
  warnUnpriced(method: string, path: string): void {
    this.warnOnce(
      `${X402_LOG_PREFIX} @X402() on ${method} ${path} has no dashboard price; ` +
        'it answers 503 until one is added',
    );
  }

  private prepared(resourceServer: x402ResourceServer, routes: RoutesConfig): PreparedServer {
    const httpServer = new x402HTTPResourceServer(resourceServer, routes);
    const payers = new WeakMap<object, string>();
    resourceServer.onAfterVerify(async ({ paymentPayload, result }) => {
      if (result.payer) payers.set(paymentPayload, result.payer);
    });
    let initialized: Promise<void> | undefined;
    const prepare = () => {
      initialized ??= (async () => {
        await httpServer.initialize();
        if (!checkIfBazaarNeeded(routes)) return;
        const bazaar = loadBazaar();
        if (!bazaar) return;
        if (!resourceServer.hasExtension('bazaar')) {
          resourceServer.registerExtension(bazaar.bazaarResourceServerExtension);
        }
        bazaar.validateBazaarRouteExtensions(routes);
      })().catch((error: unknown) => {
        initialized = undefined;
        throw error;
      });
      return initialized;
    };
    return { httpServer, prepare, payerOf: (payload) => payers.get(payload) };
  }

  /** The `@X402()` handlers, with their controller and method paths. */
  private discoverDecorated(): DecoratedRoute[] {
    const routes: DecoratedRoute[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      const controllerPaths = asArray<string>(Reflect.getMetadata(PATH_METADATA, metatype) ?? '/');
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name] as object;
        const meta = this.reflector.getAllAndOverride<X402RouteMetadata | undefined>(
          X402_ROUTE_METADATA,
          [handler as () => unknown, metatype],
        );
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        if (!meta || methodPath === undefined) continue;
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
        const method = requestMethod === RequestMethod.ALL ? '*' : RequestMethod[requestMethod];
        for (const controllerPath of controllerPaths) {
          for (const path of asArray(methodPath)) {
            routes.push({ method, path: joinPath(controllerPath, path), priceInCode: !!meta.route });
          }
        }
      }
    }
    return routes;
  }

  /**
   * Warns about mismatches between the dashboard and the `@X402()` handlers.
   * A handler's path matches a dashboard path that ends with it, so a global
   * prefix or a version segment is allowed for.
   */
  private checkRoutes(routes: RoutesConfig): void {
    if (!this.decorated) return;
    const dashboard = Object.keys(routes).map(parseRouteKey);
    const decorated = this.decorated.filter((route) => !route.priceInCode);
    const serves = (handler: DecoratedRoute, priced: DecoratedRoute) =>
      (handler.method === '*' || priced.method === '*' || handler.method === priced.method) &&
      endsWithSegments(priced.path, handler.path);

    for (const priced of dashboard) {
      if (!decorated.some((handler) => serves(handler, priced))) {
        this.warnOnce(
          `${X402_LOG_PREFIX} the dashboard prices ${priced.method} ${priced.path}, ` +
            'but no @X402() handler serves it: this app serves it for free',
        );
      }
    }
    for (const handler of decorated) {
      if (!dashboard.some((priced) => serves(handler, priced))) {
        this.warnUnpriced(handler.method, handler.path);
      }
    }
  }

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.logger.warn(message);
  }
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function joinPath(...parts: string[]): string {
  return `/${parts.flatMap(segments).join('/')}`;
}

/** `GET /a/b` → `{ GET, /a/b }`; a bare path matches any method. */
function parseRouteKey(key: string): DecoratedRoute {
  const [first, ...rest] = key.trim().split(/\s+/);
  return rest.length > 0
    ? { method: first.toUpperCase(), path: joinPath(rest.join(' ')), priceInCode: false }
    : { method: '*', path: joinPath(first), priceInCode: false };
}

function endsWithSegments(path: string, suffix: string): boolean {
  const whole = segments(path);
  const tail = segments(suffix);
  if (tail.length > whole.length) return false;
  const offset = whole.length - tail.length;
  return tail.every((segment, index) => {
    const other = whole[offset + index];
    // `:param` in either path matches any one segment.
    return segment === other || segment.startsWith(':') || other.startsWith(':');
  });
}
