import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown for a request that needs payment, or whose payment failed. The
 * `PAYMENT-REQUIRED` header is already on the response, so the default
 * exception filter, or yours, sends it with this body and status.
 */
export class X402PaymentRequiredException extends HttpException {
  constructor(body: unknown = {}, status: number = HttpStatus.PAYMENT_REQUIRED) {
    super((body ?? {}) as Record<string, unknown>, status);
  }
}
