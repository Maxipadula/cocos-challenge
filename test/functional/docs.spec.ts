import { readFileSync } from 'node:fs';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { AppModule } from '../../src/app.module.js';
import { createOpenApiDocument } from '../../src/docs/openapi-document.js';
import { openApiToPostman, validateOpenApi } from '../../src/docs/postman-collection.js';
import { rememberDocumentationApp } from '../../src/docs/serve-docs.js';

describe('OpenAPI documentation', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: async () => undefined,
        $disconnect: async () => undefined,
        $transaction: async () => undefined,
      })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    rememberDocumentationApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('publishes the OpenAPI document and ReDoc without a CDN', async () => {
    const document = createOpenApiDocument(app);
    const served = await fetch(`${baseUrl}/openapi.json`);
    const docs = await fetch(`${baseUrl}/docs`);
    const script = await fetch(`${baseUrl}/docs/redoc.standalone.js`);
    const html = await docs.text();

    expect(served.status).toBe(200);
    expect(await served.json()).toEqual(document);
    expect(document.paths?.['/instruments']?.get).toBeDefined();
    expect(document.paths?.['/portfolio']?.get).toBeDefined();
    expect(document.paths?.['/orders']?.post).toBeDefined();
    expect(document.paths?.['/orders/{orderId}/cancel']?.post).toBeDefined();
    expect(document.paths?.['/cash-movements']?.post).toBeDefined();
    expect(headerNames(document.paths?.['/portfolio']?.get)).toContain(
      'X-User-Id',
    );
    expect(headerNames(document.paths?.['/orders']?.post)).toEqual(
      expect.arrayContaining(['X-User-Id', 'Idempotency-Key']),
    );
    expect(orderExamples(document.paths?.['/orders']?.post)).toMatchObject({
      marketBuy: { value: { side: 'BUY', type: 'MARKET' } },
      marketSell: { value: { side: 'SELL', type: 'MARKET' } },
      limitBuy: { value: { side: 'BUY', type: 'LIMIT' } },
      limitSell: { value: { side: 'SELL', type: 'LIMIT' } },
    });
    expect(docs.status).toBe(200);
    expect(html).toContain('spec-url="/openapi.json"');
    expect(html).toContain('type="module" src="/docs/redoc.standalone.js"');
    expect(html).not.toContain('cdn');
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('javascript');
    await script.arrayBuffer();
    validateOpenApi(document);
  });

  it('writes a Postman v2.1 collection derived from that document', async () => {
    const document = createOpenApiDocument(app);
    const collection = await openApiToPostman(document);
    const stored = JSON.parse(
      readFileSync('postman/cocos-api.postman_collection.json', 'utf8'),
    ) as typeof collection;
    const names = collection.item.map((item) => item.name);

    expect(collection.info.schema).toBe(
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    );
    expect(collection.variable.map((variable) => variable.key)).toEqual([
      'baseUrl',
      'userId',
      'instrumentId',
      'orderId',
      'idempotencyKey',
    ]);
    expect(names).toEqual([
      'Search instruments',
      'Read a portfolio',
      'MARKET BUY by quantity',
      'MARKET SELL by quantity',
      'LIMIT BUY by amount',
      'LIMIT SELL by quantity',
      'Cancel a new limit order',
      'Deposit',
      'Withdrawal',
    ]);
    expect(JSON.stringify(collection)).toContain('{{baseUrl}}');
    expect(JSON.stringify(collection)).toContain('{{userId}}');
    expect(JSON.stringify(collection)).toContain('{{instrumentId}}');
    expect(JSON.stringify(collection)).toContain('{{orderId}}');
    expect(JSON.stringify(collection)).toContain('{{idempotencyKey}}');
    expect(stored).toEqual(collection);
  });
});

function headerNames(operation: object | undefined): string[] {
  const parameters = (operation as { parameters?: unknown[] } | undefined)
    ?.parameters;

  return (parameters ?? []).flatMap((parameter) => {
    if (
      typeof parameter === 'object' &&
      parameter &&
      'in' in parameter &&
      parameter.in === 'header' &&
      'name' in parameter &&
      typeof parameter.name === 'string'
    ) {
      return [parameter.name];
    }

    return [];
  });
}

function orderExamples(operation: object | undefined) {
  const body = (operation as { requestBody?: unknown } | undefined)?.requestBody;

  if (
    typeof body !== 'object' ||
    body === null ||
    !('content' in body) ||
    typeof body.content !== 'object' ||
    body.content === null ||
    !('application/json' in body.content)
  ) {
    return undefined;
  }

  const json = body.content['application/json'];

  return typeof json === 'object' && json && 'examples' in json
    ? json.examples
    : undefined;
}
