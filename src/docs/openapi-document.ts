import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import {
  CancelledOrderResponse,
  ErrorMessageResponse,
  InstrumentResponse,
  PortfolioResponse,
  SubmittedCashMovementResponse,
  SubmittedOrderResponse,
} from './http-schemas.js';

const DESCRIPTION = [
  'HTTP API for searching instruments, reading a portfolio, submitting trade orders, and cancelling a new limit order.',
  '',
  'Callers are identified by the X-User-Id header. There is no authentication.',
  'Write operations require an Idempotency-Key header. Repeating the same key and the same request returns the stored result. The same key with a different request returns 409.',
  '',
  'MARKET orders execute immediately at the latest close and are stored as FILLED, or as REJECTED when the available cash or shares are insufficient. Rejected orders are persisted.',
  'LIMIT orders that pass the same availability check are stored as NEW and reserve cash (BUY) or shares (SELL). They are not executed and there is no matching engine.',
  'Only a LIMIT order in status NEW can be cancelled. Cancelling releases exactly that reservation.',
  '',
  'Amounts and quantities are decimal or integer strings. The API does not accept JSON numbers for them.',
  'POST /cash-movements records a deposit or a withdrawal against the ARS instrument. The client does not send an instrument id, a price, or an order type.',
].join('\n');

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Cocos API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0.0')
    .addServer('http://localhost:3000')
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [
      ErrorMessageResponse,
      InstrumentResponse,
      PortfolioResponse,
      SubmittedOrderResponse,
      CancelledOrderResponse,
      SubmittedCashMovementResponse,
    ],
  });

  annotatePostman(document);
  return document;
}

function annotatePostman(document: ReturnType<typeof SwaggerModule.createDocument>): void {
  const saveOrder =
    "const body = pm.response.json();\nif (body && body.id) {\n  pm.collectionVariables.set('orderId', body.id);\n}";
  const freshKey =
    "pm.collectionVariables.set('idempotencyKey', pm.variables.replaceIn('{{$guid}}'));";

  extend(document.paths['/instruments']?.get, {
    'x-postman-test':
      "const body = pm.response.json();\nif (Array.isArray(body) && body[0] && body[0].id) {\n  pm.collectionVariables.set('instrumentId', body[0].id);\n}",
  });
  extend(document.paths['/orders']?.post, {
    'x-postman-test': saveOrder,
    'x-postman-prerequest': freshKey,
  });
  extend(document.paths['/orders/{orderId}/cancel']?.post, {
    'x-postman-prerequest': freshKey,
  });
  extend(document.paths['/cash-movements']?.post, {
    'x-postman-prerequest': freshKey,
  });
}

function extend(
  operation: object | undefined,
  fields: Record<string, string>,
): void {
  if (!operation) {
    return;
  }

  Object.assign(operation, fields);
}
