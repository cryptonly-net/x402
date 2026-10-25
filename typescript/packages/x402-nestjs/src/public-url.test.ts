import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { Controller, Get, Module, Param, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { X402PublicUrlOptions } from '@cryptonly/x402';
import { resource, x402Config } from '../../x402/src/config.fixture.js';
import {
  FACILITATOR_BASE_URL,
  configFetchOf,
  decodeHeader,
  facilitatorFetch,
  paymentFor,
  type FacilitatorCalls,
} from '../../x402/src/facilitator.fixture.js';
import { X402, X402Module } from './index.js';

@Controller('aml')
class AmlController {
  @X402()
  @Get('screen/:address')
  screen(@Param('address') address: string) {
    return { address, sanctioned: false };
  }
}

type Platform = 'express' | 'fastify';

async function start(
  platform: Platform,
  globalPrefix: string,
  pricedPath: string,
  options: X402PublicUrlOptions,
  warnings: string[] = [],
): Promise<{ app: INestApplication; base: string }> {
  @Module({
    imports: [
      X402Module.forRoot({
        apiKey: 'k',
        baseUrl: FACILITATOR_BASE_URL,
        fetch: configFetchOf(x402Config({ resources: [resource({ path: pricedPath })] })),
        logger: {
          info: () => {},
          warn: (message: string) => warnings.push(message),
          error: () => {},
        },
        refreshIntervalMs: 0,
        ...options,
      }),
    ],
    controllers: [AmlController],
  })
  class AppModule {}

  const app =
    platform === 'fastify'
      ? await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false })
      : await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix(globalPrefix);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${port}` };
}

describe.each<Platform>(['express', 'fastify'])('X402Module behind a proxy on %s', (platform) => {
  const realFetch = globalThis.fetch;
  const calls: FacilitatorCalls = { verified: [], settled: [] };
  let app: INestApplication | undefined;

  beforeEach(() => {
    calls.verified.length = 0;
    calls.settled.length = 0;
    globalThis.fetch = facilitatorFetch(calls, realFetch);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    globalThis.fetch = realFetch;
  });

  it.each([
    {
      name: 'a proxy that strips /v1',
      prefix: 'api',
      priced: '/v1/api/aml/screen/:address',
      options: { pathPrefix: '/v1', publicBaseUrl: 'https://api.example.com' },
      request: '/api/aml/screen/0xabc?chain=base',
      resourceUrl: 'https://api.example.com/v1/api/aml/screen/0xabc?chain=base',
    },
    {
      name: 'a proxy that adds /tenant-api-key',
      prefix: 'tenant-api-key',
      priced: '/aml/screen/:address',
      options: { publicPath: (path: string) => path.replace(/^\/tenant-api-key/, '') },
      request: '/tenant-api-key/aml/screen/0xabc',
      resourceUrl: '{base}/aml/screen/0xabc',
    },
  ])('prices and settles the public path behind $name', async (c) => {
    const started = await start(platform, c.prefix, c.priced, c.options);
    app = started.app;

    const unpaid = await realFetch(`${started.base}${c.request}`);
    expect(unpaid.status).toBe(402);
    const required = unpaid.headers.get('payment-required')!;
    expect(decodeHeader(required).resource.url).toBe(
      c.resourceUrl.replace('{base}', started.base),
    );

    const paid = await realFetch(`${started.base}${c.request}`, {
      headers: { 'payment-signature': paymentFor(required) },
    });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toEqual({ address: '0xabc', sanctioned: false });
    expect(calls.settled).toHaveLength(1);
  });

  it('answers 503 without the mapping, and says why once per handler', async () => {
    const warnings: string[] = [];
    const started = await start(platform, 'tenant-api-key', '/aml/screen/:address', {}, warnings);
    app = started.app;

    for (const address of ['0xabc', '0xdef', '0x123']) {
      const res = await realFetch(`${started.base}/tenant-api-key/aml/screen/${address}`);
      expect(res.status).toBe(503);
    }

    const unpriced = warnings.filter((message) => message.includes('has no dashboard price'));
    expect(unpriced).toEqual([
      expect.stringContaining(
        'The dashboard prices GET /aml/screen/:address: if a proxy rewrites the path, ' +
          'set `pathPrefix` or `publicPath`',
      ),
    ]);
    expect(calls.verified).toHaveLength(0);
  });
});
