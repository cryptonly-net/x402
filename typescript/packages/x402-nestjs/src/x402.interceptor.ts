import {
  BadGatewayException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  FacilitatorResponseError,
  SETTLEMENT_OVERRIDES_HEADER,
  withPrivateCacheControl,
  type HTTPProcessResult,
  type HTTPRequestContext,
  type VerifiedPaymentCancelOptions,
} from '@x402/core/server';
import { X402_CONFIG_UNAVAILABLE, X402_LOG_PREFIX, describeError } from '@cryptonly/x402';
import { from, mergeMap, catchError, throwError, type Observable } from 'rxjs';
import type { X402RouteMetadata, X402VerifiedPayment } from './decorators.js';
import { X402PaymentRequiredException } from './exceptions.js';
import {
  headerOf,
  headersOf,
  requestContextOf,
  setHeaders,
  type PlatformRequest,
  type PlatformResponse,
} from './request-adapter.js';
import { X402_PAYMENT, X402_ROUTE_METADATA } from './x402.options.js';
import { X402Service, type PreparedServer } from './x402.service.js';

type Verified = Extract<HTTPProcessResult, { type: 'payment-verified' }>;

/** A verified payment, waiting for the handler. */
type Pending = {
  server: PreparedServer;
  request: HTTPRequestContext;
  result: Verified;
};

/**
 * Gates an `@X402()` handler: verifies the payment before the handler and
 * settles it after the handler succeeds. Added by {@link X402}; it does
 * nothing on handlers without it.
 */
@Injectable()
export class X402Interceptor implements NestInterceptor {
  constructor(
    private readonly x402: X402Service,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const meta = this.reflector.getAllAndOverride<X402RouteMetadata | undefined>(
      X402_ROUTE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<PlatformRequest & { [X402_PAYMENT]?: X402VerifiedPayment }>();
    const res = http.getResponse<PlatformResponse>();
    return from(this.verify(context, meta, req, res)).pipe(
      mergeMap((pending) => (pending ? this.settleAfter(pending, res, next) : next.handle())),
    );
  }

  private async verify(
    context: ExecutionContext,
    meta: X402RouteMetadata,
    req: PlatformRequest & { [X402_PAYMENT]?: X402VerifiedPayment },
    res: PlatformResponse,
  ): Promise<Pending | undefined> {
    let server: PreparedServer | undefined;
    if (meta.route) {
      server = this.x402.inCodeServer(context.getHandler(), meta.route);
    } else {
      server = await this.x402.dashboardServer();
      if (!server) {
        res.header('Retry-After', String(Math.ceil(this.x402.retryAfterMs / 1000)));
        throw new ServiceUnavailableException(X402_CONFIG_UNAVAILABLE);
      }
    }

    const request = this.x402.requestContext(requestContextOf(req));
    if (!server.httpServer.requiresPayment(request)) {
      // Fail closed: a paid handler is never served for free.
      this.x402.warnUnpricedRequest(context.getHandler(), request.method, request.path);
      throw new ServiceUnavailableException({
        error: 'x402_route_unpriced',
        message: 'This endpoint has no price yet; retry later.',
      });
    }

    let result: HTTPProcessResult;
    try {
      await server.prepare();
      result = await server.httpServer.processHTTPRequest(request);
    } catch (error) {
      throw this.facilitatorFailure(error);
    }

    switch (result.type) {
      case 'no-payment-required':
        return undefined;
      case 'payment-error':
        setHeaders(res, result.response.headers);
        throw new X402PaymentRequiredException(result.response.body, result.response.status);
      case 'payment-verified': {
        const { paymentPayload, paymentRequirements } = result;
        req[X402_PAYMENT] = {
          payer: server.payerOf(paymentPayload) ?? payerFromPayload(paymentPayload.payload),
          scheme: paymentRequirements.scheme,
          network: paymentRequirements.network,
          amount: paymentRequirements.amount,
          asset: paymentRequirements.asset,
          payTo: paymentRequirements.payTo,
          payload: paymentPayload,
          requirements: paymentRequirements,
        };
        return { server, request, result };
      }
    }
  }

  private settleAfter(
    pending: Pending,
    res: PlatformResponse,
    next: CallHandler,
  ): Observable<unknown> {
    let settled = false;
    return next.handle().pipe(
      // Exceptions from pipes (validation) and the handler: no charge.
      catchError((error: unknown) =>
        from(this.cancel(pending, res, { reason: 'handler_threw', error })).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
      mergeMap(async (body: unknown) => {
        if (settled) return body;
        settled = true;
        await this.settle(pending, res, body);
        return body;
      }),
    );
  }

  private async settle(pending: Pending, res: PlatformResponse, body: unknown): Promise<void> {
    const { server, request, result } = pending;
    // Set when a handler with `@Res({ passthrough: true })` chose an error status.
    if (res.statusCode >= 400) {
      await this.cancel(pending, res, { reason: 'handler_failed', responseStatus: res.statusCode });
      return;
    }
    try {
      const settlement = await server.httpServer.processSettlement(
        result.paymentPayload,
        result.paymentRequirements,
        result.declaredExtensions,
        { request, responseBody: bodyBuffer(body), responseHeaders: headersOf(res) },
        undefined,
        result.beforeHandlerSettlement,
      );
      res.removeHeader(SETTLEMENT_OVERRIDES_HEADER);
      if (!settlement.success) {
        setHeaders(res, settlement.response.headers);
        throw new X402PaymentRequiredException(
          settlement.response.body,
          settlement.response.status,
        );
      }
      setHeaders(res, settlement.headers);
      res.header('Cache-Control', withPrivateCacheControl(headerOf(res, 'Cache-Control')));
    } catch (error) {
      res.removeHeader(SETTLEMENT_OVERRIDES_HEADER);
      if (error instanceof HttpException) throw error;
      if (error instanceof FacilitatorResponseError) {
        throw new BadGatewayException({ error: error.message });
      }
      this.x402.logger.error(`${X402_LOG_PREFIX} settlement failed: ${describeError(error)}`);
      throw new X402PaymentRequiredException({});
    }
  }

  private async cancel(
    pending: Pending,
    res: PlatformResponse,
    options: VerifiedPaymentCancelOptions,
  ): Promise<void> {
    const { server, result } = pending;
    try {
      const canceled = await result.cancellationDispatcher.cancel(options);
      res.removeHeader(SETTLEMENT_OVERRIDES_HEADER);
      const headers = server.httpServer.createFailurePathSettlementHeaders(
        canceled,
        result.beforeHandlerSettlement,
        result.paymentPayload,
        headerOf(res, 'Cache-Control'),
      );
      if (headers) setHeaders(res, headers);
    } catch (error) {
      // The handler's own error is the one to answer with.
      this.x402.logger.error(`${X402_LOG_PREFIX} cancelling a payment failed: ${describeError(error)}`);
    }
  }

  private facilitatorFailure(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof FacilitatorResponseError) {
      return new BadGatewayException({ error: error.message });
    }
    this.x402.logger.error(`${X402_LOG_PREFIX} payment processing failed: ${describeError(error)}`);
    return new InternalServerErrorException();
  }
}

/** The handler's result as the bytes the settlement sees. */
function bodyBuffer(body: unknown): Buffer {
  if (body === undefined || body === null || body instanceof StreamableFile) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
}

/** The `from` of an EVM authorization or Permit2 payload, when the facilitator gave no payer. */
function payerFromPayload(payload: Record<string, unknown>): string | undefined {
  const authorization = payload.authorization as { from?: unknown } | undefined;
  const permit2 = payload.permit2Authorization as { from?: unknown } | undefined;
  const from = authorization?.from ?? permit2?.from;
  return typeof from === 'string' ? from : undefined;
}
