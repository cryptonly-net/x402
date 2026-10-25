import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import {
  BadRequestException,
  Controller,
  Get,
  Module,
  Param,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { X402Config } from '@cryptonly/x402';
import { resource, x402Config } from '../../x402/src/config.fixture.js';
import {
  FACILITATOR_BASE_URL,
  configFetchOf,
  decodeHeader,
  facilitatorFetch,
  muteBazaarImportLog,
  paymentFor,
  type FacilitatorCalls,
} from '../../x402/src/facilitator.fixture.js';
import { cryptonlyPaymentMiddleware, type CryptonlyPaymentMiddleware } from './index.js';

// The plain middleware also works under Nest's Express platform, mounted with
// `MiddlewareConsumer`: Nest registers it as a route (`app.all(path)`), so
// `req.path` is the full path the dashboard resources are keyed by.
// `@cryptonly/x402-nestjs` is the declarative way.

const config: X402Config = x402Config({
  resources: [
    resource({
      method: 'GET',
      path: '/aml/screen/:address',
    }),
  ],
});

@Controller('aml')
class AmlController {
  @Get('screen/:address')
  screen(@Param('address') address: string) {
    if (!address.startsWith('0x')) throw new BadRequestException('invalid address');
    return { address, sanctioned: false };
  }

  @Get('free')
  free() {
    return { free: true };
  }
}

let middleware: CryptonlyPaymentMiddleware;

@Module({ controllers: [AmlController] })
class AmlModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(middleware).forRoutes(AmlController);
  }
}

describe('cryptonlyPaymentMiddleware under NestJS', () => {
  const realFetch = globalThis.fetch;
  const calls: FacilitatorCalls = { verified: [], settled: [] };
  let app: INestApplication;
  let base: string;
  let consoleError: jest.SpyInstance;

  beforeAll(async () => {
    consoleError = muteBazaarImportLog();
    globalThis.fetch = facilitatorFetch(calls, realFetch);
    middleware = cryptonlyPaymentMiddleware({
      apiKey: 'k',
      baseUrl: FACILITATOR_BASE_URL,
      fetch: configFetchOf(config),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      refreshIntervalMs: 0,
    });
    app = await NestFactory.create<NestExpressApplication>(AmlModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    middleware.close();
    await app.close();
    globalThis.fetch = realFetch;
    consoleError.mockRestore();
  });

  beforeEach(() => {
    calls.settled.length = 0;
  });

  it('answers 402 on a dashboard route and passes free routes through', async () => {
    const unpaid = await realFetch(`${base}/aml/screen/0xabc`);
    expect(unpaid.status).toBe(402);
    const required = decodeHeader(unpaid.headers.get('payment-required')!);
    expect(required.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'eip155:84532',
      amount: '1000',
      payTo: config.payTo.address,
    });

    const free = await realFetch(`${base}/aml/free`);
    expect(free.status).toBe(200);
    expect(await free.json()).toEqual({ free: true });
  });

  it('runs the handler, then settles, when the payment verifies', async () => {
    const unpaid = await realFetch(`${base}/aml/screen/0xabc`);
    const paid = await realFetch(`${base}/aml/screen/0xabc`, {
      headers: { 'payment-signature': paymentFor(unpaid.headers.get('payment-required')!) },
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toEqual({ address: '0xabc', sanctioned: false });
    expect(paid.headers.get('payment-response')).toBeTruthy();
    expect(calls.settled).toHaveLength(1);
  });

  it('does not settle when the handler answers 4xx', async () => {
    const unpaid = await realFetch(`${base}/aml/screen/nope`);
    const rejected = await realFetch(`${base}/aml/screen/nope`, {
      headers: { 'payment-signature': paymentFor(unpaid.headers.get('payment-required')!) },
    });
    expect(rejected.status).toBe(400);
    expect(calls.settled).toHaveLength(0);
  });
});
