import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { X402RouteSourceOptions } from '@cryptonly/x402';

/** Options for `X402Module.forRoot()` and `forRootAsync()`. */
export type X402ModuleOptions = X402RouteSourceOptions & {
  /**
   * Await the dashboard configuration during application bootstrap, so a bad
   * key or an inactive account fails startup. Defaults to `false`: it loads
   * on the first paid request, which answers 503 until it does.
   */
  waitForConfig?: boolean;
};

export const {
  ConfigurableModuleClass: X402ConfigurableModule,
  MODULE_OPTIONS_TOKEN: X402_MODULE_OPTIONS,
  OPTIONS_TYPE: X402_OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE: X402_ASYNC_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<X402ModuleOptions>()
  .setClassMethodName('forRoot')
  .setExtras({ isGlobal: false }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal,
  }))
  .build();

/** Metadata key of {@link X402} on handlers and controllers. */
export const X402_ROUTE_METADATA = 'cryptonly:x402:route';

/** Where the interceptor puts the verified payment on the request. */
export const X402_PAYMENT = Symbol.for('cryptonly.x402.payment');
