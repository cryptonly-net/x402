import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { X402Interceptor } from './x402.interceptor.js';
import { X402ConfigurableModule } from './x402.options.js';
import { X402Service } from './x402.service.js';

/**
 * x402 payments with Cryptonly as the facilitator. Register it once, then
 * mark paid handlers with `@X402()`.
 *
 * @example
 * ```ts
 * @Module({
 *   imports: [
 *     X402Module.forRoot({ apiKey: process.env.CRYPTONLY_API_KEY!, isGlobal: true }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({
  imports: [DiscoveryModule],
  providers: [X402Service, X402Interceptor],
  exports: [X402Service, X402Interceptor],
})
export class X402Module extends X402ConfigurableModule {}
