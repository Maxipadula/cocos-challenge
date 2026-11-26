import { createRequire } from 'node:module';

import type { OpenAPIObject } from '@nestjs/swagger';

const require = createRequire(import.meta.url);
const converter = require('openapi-to-postmanv2') as {
  convert: (
    input: { type: 'json'; data: OpenAPIObject },
    options: { parametersResolution: 'Example'; requestNameSource: 'Fallback' },
    callback: (
      error: Error | null,
      result: {
        result: boolean;
        reason?: string;
        output?: Array<{ type: string; data: PostmanCollection }>;
      },
    ) => void,
  ) => void;
  validate: (input: { type: 'json'; data: OpenAPIObject }) => {
    result: boolean;
    reason?: string;
  };
};

const COLLECTION_SCHEMA =
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

const SEED_USER = 'a1000000-0000-4000-8000-000000000001';
const SEED_GGAL = 'a3000000-0000-4000-8000-000000000022';

type PostmanCollection = {
  info: { name: string; description?: string; schema: string };
  item: PostmanItem[];
  variable: Array<{ key: string; value: string }>;
};

type PostmanItem = {
  name: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  event?: PostmanEvent[];
};

type PostmanRequest = {
  method: string;
  header: Array<{ key: string; value: string }>;
  url: string;
  description?: string;
  body?: { mode: 'raw'; raw: string };
};

type PostmanEvent = {
  listen: 'test' | 'prerequest';
  script: { type: 'text/javascript'; exec: string[] };
};

type JsonOperation = {
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    example?: unknown;
    schema?: { example?: unknown; default?: unknown };
  }>;
  requestBody?: {
    content?: {
      'application/json'?: {
        example?: unknown;
        examples?: Record<string, { summary?: string; value?: unknown }>;
      };
    };
  };
  'x-postman-test'?: string;
  'x-postman-prerequest'?: string;
};

export function validateOpenApi(document: OpenAPIObject): void {
  const validation = converter.validate({ type: 'json', data: document });

  if (!validation.result) {
    throw new Error(validation.reason ?? 'OpenAPI document is not valid.');
  }
}

export async function openApiToPostman(
  document: OpenAPIObject,
): Promise<PostmanCollection> {
  validateOpenApi(document);
  const converted = await convert(document);
  const requests = requestsFromDocument(document);

  return {
    info: {
      name: converted.info.name || 'Cocos API',
      description: document.info.description,
      schema: COLLECTION_SCHEMA,
    },
    item: requests,
    variable: [
      { key: 'baseUrl', value: 'http://localhost:3000' },
      { key: 'userId', value: SEED_USER },
      { key: 'instrumentId', value: SEED_GGAL },
      { key: 'orderId', value: '' },
      { key: 'idempotencyKey', value: '' },
    ],
  };
}

export function localPostmanEnvironment() {
  return {
    name: 'Cocos local',
    values: [
      {
        key: 'baseUrl',
        value: 'http://localhost:3000',
        type: 'default',
        enabled: true,
      },
      {
        key: 'userId',
        value: SEED_USER,
        type: 'default',
        enabled: true,
      },
      {
        key: 'instrumentId',
        value: SEED_GGAL,
        type: 'default',
        enabled: true,
      },
      { key: 'orderId', value: '', type: 'default', enabled: true },
      {
        key: 'idempotencyKey',
        value: '',
        type: 'default',
        enabled: true,
      },
    ],
    _postman_variable_scope: 'environment',
  };
}

function convert(document: OpenAPIObject): Promise<PostmanCollection> {
  return new Promise((resolve, reject) => {
    converter.convert(
      { type: 'json', data: document },
      { parametersResolution: 'Example', requestNameSource: 'Fallback' },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        const collection = result.output?.[0]?.data;

        if (!result.result || !collection) {
          reject(new Error(result.reason ?? 'OpenAPI conversion failed.'));
          return;
        }

        resolve(collection);
      },
    );
  });
}

const REQUEST_ORDER = [
  'get /instruments',
  'get /portfolio',
  'post /orders',
  'post /orders/{orderId}/cancel',
  'post /cash-movements',
];

const EXAMPLE_ORDER = [
  'marketBuy',
  'marketSell',
  'limitBuy',
  'limitSell',
  'cashIn',
  'cashOut',
];

function requestsFromDocument(document: OpenAPIObject): PostmanItem[] {
  const operations = Object.entries(document.paths ?? {}).flatMap(([path, pathItem]) =>
    (['get', 'post', 'put', 'patch', 'delete'] as const).flatMap((method) => {
      const operation = pathItem?.[method] as JsonOperation | undefined;

      return operation ? [{ method, path, operation }] : [];
    }),
  );

  operations.sort(
    (left, right) =>
      REQUEST_ORDER.indexOf(`${left.method} ${left.path}`) -
      REQUEST_ORDER.indexOf(`${right.method} ${right.path}`),
  );

  return operations.flatMap(({ method, path, operation }) => {
    const examples = operation.requestBody?.content?.['application/json']?.examples;

    if (!examples) {
      return [
        requestItem(
          method,
          path,
          operation,
          operation.summary,
          operation.requestBody?.content?.['application/json']?.example,
        ),
      ];
    }

    return Object.entries(examples)
      .sort(
        ([left], [right]) =>
          EXAMPLE_ORDER.indexOf(left) - EXAMPLE_ORDER.indexOf(right),
      )
      .map(([, example]) =>
        requestItem(method, path, operation, example.summary, example.value),
      );
  });
}

function requestItem(
  method: string,
  path: string,
  operation: JsonOperation,
  name: string | undefined,
  body: unknown,
): PostmanItem {
  const headers = [
    { key: 'X-User-Id', value: '{{userId}}' },
    ...(operation['x-postman-prerequest']
      ? [{ key: 'Idempotency-Key', value: '{{idempotencyKey}}' }]
      : []),
    ...(body !== undefined
      ? [{ key: 'Content-Type', value: 'application/json' }]
      : []),
  ];
  const item: PostmanItem = {
    name: name ?? `${method.toUpperCase()} ${path}`,
    request: {
      method: method.toUpperCase(),
      header: headers.filter((header) => headerApplies(header.key, operation)),
      url: `{{baseUrl}}${path.replaceAll('{', '{{').replaceAll('}', '}}')}${queryString(operation)}`,
      description: operation.description,
      ...(body !== undefined
        ? {
            body: {
              mode: 'raw' as const,
              raw: JSON.stringify(substituteVariables(body), null, 2),
            },
          }
        : {}),
    },
  };
  const events: PostmanEvent[] = [];

  if (operation['x-postman-prerequest']) {
    events.push(script('prerequest', operation['x-postman-prerequest']));
  }

  if (operation['x-postman-test']) {
    events.push(script('test', operation['x-postman-test']));
  }

  if (events.length > 0) {
    item.event = events;
  }

  return item;
}

function headerApplies(name: string, operation: JsonOperation): boolean {
  if (name === 'Content-Type') {
    return true;
  }

  return (operation.parameters ?? []).some(
    (parameter) =>
      parameter.in === 'header' && parameter.name.toLowerCase() === name.toLowerCase(),
  );
}

function queryString(operation: JsonOperation): string {
  const query = (operation.parameters ?? []).filter(
    (parameter) => parameter.in === 'query',
  );

  if (query.length === 0) {
    return '';
  }

  const pairs = query
    .filter((parameter) => parameter.required !== false)
    .map((parameter) => {
    const value =
      parameter.example ??
      parameter.schema?.example ??
      parameter.schema?.default ??
      '';

    return `${encodeURIComponent(parameter.name)}=${encodeURIComponent(String(value))}`;
  });

  return `?${pairs.join('&')}`;
}

function substituteVariables(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => substituteVariables(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        key === 'instrumentId' ? '{{instrumentId}}' : substituteVariables(nested),
      ]),
    );
  }

  return value;
}

function script(listen: 'test' | 'prerequest', source: string): PostmanEvent {
  return {
    listen,
    script: {
      type: 'text/javascript',
      exec: source.split('\n'),
    },
  };
}
