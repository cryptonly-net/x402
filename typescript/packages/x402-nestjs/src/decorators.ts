import {
  SetMetadata,
  UseInterceptors,
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { RouteConfig } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { X402_PAYMENT, X402_ROUTE_METADATA } from './x402.options.js';
import { X402Interceptor } from './x402.interceptor.js';

/** What {@link X402} stores on a handler or controller. */
export type X402RouteMetadata = {
  /** The price in code; without it the price comes from the dashboard. */
  route?: RouteConfig;
};

/**
 * Requires an x402 payment for a handler, or for every handler of a
 * controller.
 *
 * - `@X402()`: the price comes from the dashboard resource with the same
 *   method and path. A route the dashboard doesn't price answers 503.
 * - `@X402({ accepts: { scheme, price, network, payTo } })`: the price is
 *   in code, as a stock `@x402/core` `RouteConfig`.
 *
 * The payment is verified before the handler runs and settled after it
 * succeeds. An exception, including a validation error, cancels it.
 */
export function X402(route?: RouteConfig): ClassDecorator & MethodDecorator {
  return applyDecorators(
    SetMetadata(X402_ROUTE_METADATA, { route } satisfies X402RouteMetadata),
    UseInterceptors(X402Interceptor),
  );
}

/** The payment of a request, as verified before the handler. Not yet settled. */
export type X402VerifiedPayment = {
  /** The paying wallet, as the facilitator verified it. */
  payer?: string;
  scheme: string;
  network: string;
  /** Atomic units of {@link asset}. */
  amount: string;
  asset: string;
  payTo: string;
  payload: PaymentPayload;
  requirements: PaymentRequirements;
};

/** Injects the {@link X402VerifiedPayment} of the request into an `@X402()` handler. */
export const X402Payment = createParamDecorator(
  (_data: unknown, context: ExecutionContext): X402VerifiedPayment | undefined =>
    context.switchToHttp().getRequest()[X402_PAYMENT],
);
