import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { IsString, Matches } from 'class-validator';
import type { X402Config } from '@cryptonly/x402';
import {
  BASE_SEPOLIA,
  PAY_TO,
  PERMIT2_TOKEN,
  USDC,
  resource,
  x402Config,
} from '../../x402/src/config.fixture.js';
import {
  FACILITATOR_BASE_URL,
  PAYER,
  configFetchOf,
  decodeHeader,
  facilitatorFetch,
  paymentFor,
  type FacilitatorCalls,
} from '../../x402/src/facilitator.fixture.js';
import { X402, X402Module, X402Payment, type X402VerifiedPayment } from './index.js';

class ScreenRequest {
  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/)
  address!: string;
}

@Controller('aml')
class AmlController {
  @X402()
  @Get('screen/:address')
  screen(@Param('address') address: string, @X402Payment() payment: X402VerifiedPayment) {
    if (address === 'boom') throw new Error('provider down');
    return {
      address,
      sanctioned: false,
      payer: payment.payer,
      amount: payment.amount,
    };
  }

  @X402()
  @Post('screen')
  screenBody(@Body() body: ScreenRequest) {
    return { address: body.address, sanctioned: false };
  }

  @X402()
  @Get('unpriced')
  unpriced() {
    return { unreachable: true };
  }

  @X402({
    accepts: {
      scheme: 'exact',
      price: '$0.01',
      network: 'eip155:84532',
      payTo: PAY_TO,
    },
    description: 'Priced in code',
  })
  @Get('in-code')
  inCode() {
    return { inCode: true };
  }

  @X402({
    accepts: {
      scheme: 'exact',
      price: '$0.01',
      network: 'eip155:84532',
      payTo: PAY_TO,
    },
    description: 'Quote, priced in code',
    tags: ['finance'],
    extensions: declareDiscoveryExtension({ output: { example: { price: 1 } } }),
  })
  @Get('quote/:symbol')
  quote(@Param('symbol') symbol: string) {
    return { symbol, price: 1 };
  }

  @Get('undecorated')
  undecorated() {
    return { free: true };
  }
}

// Dashboard paths carry the global prefix; handlers don't.
const config: X402Config = x402Config({
  resources: [
    resource({
      method: 'GET',
      path: '/api/aml/screen/:address',
      discoverable: true,
      tags: ['aml'],
      prices: [
        { amount: '1000', asset: USDC, currencyCode: 'USDC_BASE', network: BASE_SEPOLIA },
        { amount: '5', asset: PERMIT2_TOKEN, currencyCode: 'TKN_BASE', network: BASE_SEPOLIA },
      ],
    }),
    resource({ method: 'POST', path: '/api/aml/screen' }),
    resource({ method: 'GET', path: '/api/aml/undecorated' }),
  ],
});

// Not jest.fn(): `clearMocks` would drop what bootstrap logged before each test.
const warnings: string[] = [];
const logger = { info: () => {}, warn: (message: string) => warnings.push(message), error: () => {} };

@Module({
  imports: [
    X402Module.forRoot({
      apiKey: 'k',
      baseUrl: FACILITATOR_BASE_URL,
      fetch: configFetchOf(config),
      logger,
      refreshIntervalMs: 0,
      waitForConfig: true,
      isGlobal: true,
    }),
  ],
  controllers: [AmlController],
})
class AppModule {}

type Platform = 'express' | 'fastify';

async function start(module: unknown, platform: Platform): Promise<INestApplication> {
  const app =
    platform === 'fastify'
      ? await NestFactory.create(module as never, new FastifyAdapter(), {
          logger: false,
        })
      : await NestFactory.create(module as never, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe());
  await app.listen(0, '127.0.0.1');
  return app;
}

function baseUrlOf(app: INestApplication): string {
  const { port } = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe.each<Platform>(['express', 'fastify'])('X402Module on %s', (platform) => {
  const realFetch = globalThis.fetch;
  const calls: FacilitatorCalls = { verified: [], settled: [] };
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    globalThis.fetch = facilitatorFetch(calls, realFetch);
    warnings.length = 0;
    app = await start(AppModule, platform);
    base = baseUrlOf(app);
  });

  afterAll(async () => {
    await app.close();
    globalThis.fetch = realFetch;
  });

  beforeEach(() => {
    calls.verified.length = 0;
    calls.settled.length = 0;
  });

  async function pay(path: string, init: RequestInit = {}, option = 0) {
    const unpaid = await realFetch(`${base}${path}`, init);
    expect(unpaid.status).toBe(402);
    const required = unpaid.headers.get('payment-required')!;
    const paid = await realFetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        'payment-signature': paymentFor(required, option),
      },
    });
    return { required: decodeHeader(required), paid };
  }

  it('answers 402 with the dashboard price', async () => {
    const unpaid = await realFetch(`${base}/api/aml/screen/0xabc`);
    expect(unpaid.status).toBe(402);
    expect(decodeHeader(unpaid.headers.get('payment-required')!).accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'eip155:84532',
      amount: '1000',
      payTo: PAY_TO,
    });
    expect(calls.verified).toHaveLength(0);
  });

  it('puts the service metadata and the bazaar declaration in the dashboard 402', async () => {
    const unpaid = await realFetch(`${base}/api/aml/screen/0xabc`);
    const required = decodeHeader(unpaid.headers.get('payment-required')!);
    expect(required.resource).toMatchObject({
      serviceName: 'Weather API',
      iconUrl: 'https://cdn.example.com/icon.png',
      tags: ['aml'],
      description: 'Current weather',
    });
    expect(required.extensions.bazaar).toMatchObject({
      routeTemplate: '/api/aml/screen/:address',
      info: { input: { type: 'http', method: 'GET', pathParams: { address: '0xabc' } } },
    });
  });

  it('publishes the route template of a handler priced in code', async () => {
    const unpaid = await realFetch(`${base}/api/aml/quote/btc`);
    expect(unpaid.status).toBe(402);
    const required = decodeHeader(unpaid.headers.get('payment-required')!);
    expect(required.resource).toMatchObject({
      description: 'Quote, priced in code',
      tags: ['finance'],
    });
    expect(required.extensions.bazaar).toMatchObject({
      routeTemplate: '/api/aml/quote/:symbol',
      info: { input: { method: 'GET', pathParams: { symbol: 'btc' } } },
    });
  });

  it('runs the handler with the verified payment, then settles once', async () => {
    const { paid } = await pay('/api/aml/screen/0xabc');
    expect(paid.status).toBe(200);
    expect(await paid.json()).toEqual({
      address: '0xabc',
      sanctioned: false,
      payer: PAYER,
      amount: '1000',
    });
    expect(decodeHeader(paid.headers.get('payment-response')!)).toMatchObject({
      success: true,
      payer: PAYER,
    });
    expect(paid.headers.get('cache-control')).toContain('private');
    expect(calls.settled).toHaveLength(1);
  });

  it('offers every dashboard price and settles the one the buyer picked', async () => {
    const { required, paid } = await pay('/api/aml/screen/0xabc', {}, 1);
    expect(required.accepts).toEqual([
      expect.objectContaining({ asset: USDC, amount: '1000' }),
      expect.objectContaining({ asset: PERMIT2_TOKEN, amount: '5' }),
    ]);
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ amount: '5' });
    expect(calls.settled).toEqual([
      expect.objectContaining({
        paymentRequirements: expect.objectContaining({
          asset: PERMIT2_TOKEN,
        }),
      }),
    ]);
  });

  it('does not settle when the handler throws', async () => {
    const { paid } = await pay('/api/aml/screen/boom');
    expect(paid.status).toBe(500);
    expect(calls.verified).toHaveLength(1);
    expect(calls.settled).toHaveLength(0);
  });

  it('does not settle when validation rejects the body', async () => {
    const json = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    };
    const bad = await pay('/api/aml/screen', { ...json, body: JSON.stringify({ address: 'nope' }) });
    expect(bad.paid.status).toBe(400);
    expect(calls.settled).toHaveLength(0);

    const good = await pay('/api/aml/screen', { ...json, body: JSON.stringify({ address: '0xab' }) });
    expect(good.paid.status).toBe(201);
    expect(calls.settled).toHaveLength(1);
  });

  it('answers 503 on an @X402() route the dashboard does not price', async () => {
    const res = await realFetch(`${base}/api/aml/unpriced`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'x402_route_unpriced' });
  });

  it('serves routes without @X402() for free, even when the dashboard prices them', async () => {
    const res = await realFetch(`${base}/api/aml/undecorated`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ free: true });
  });

  it('takes a price in code', async () => {
    const { required, paid } = await pay('/api/aml/in-code');
    expect(required.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'eip155:84532',
      amount: '10000',
      payTo: PAY_TO,
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toEqual({ inCode: true });
    expect(calls.settled).toHaveLength(1);
  });

  it('warns at startup about mismatches between the dashboard and the handlers', () => {
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('the dashboard prices GET /api/aml/undecorated'),
        expect.stringContaining('@X402() on GET /aml/unpriced has no dashboard price'),
      ]),
    );
    expect(warnings.join('\n')).not.toContain('/aml/screen');
  });
});

describe('X402Module.forRootAsync', () => {
  const realFetch = globalThis.fetch;

  it('takes its options from a factory', async () => {
    const calls: FacilitatorCalls = { verified: [], settled: [] };
    globalThis.fetch = facilitatorFetch(calls, realFetch);

    @Module({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ CRYPTONLY_API_KEY: 'from-config' })],
        }),
        X402Module.forRootAsync({
          isGlobal: true,
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (settings: ConfigService) => ({
            apiKey: settings.getOrThrow<string>('CRYPTONLY_API_KEY'),
            baseUrl: FACILITATOR_BASE_URL,
            fetch: configFetchOf(config),
            logger,
            refreshIntervalMs: 0,
          }),
        }),
      ],
      controllers: [AmlController],
    })
    class AsyncAppModule {}

    const app = await start(AsyncAppModule, 'express');
    try {
      const unpaid = await realFetch(`${baseUrlOf(app)}/api/aml/screen/0xabc`);
      expect(unpaid.status).toBe(402);
    } finally {
      await app.close();
      globalThis.fetch = realFetch;
    }
  });
});
