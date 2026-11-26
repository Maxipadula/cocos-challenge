import { createRequire } from 'node:module';

import {
  Controller,
  Get,
  Header,
  type INestApplication,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { createOpenApiDocument } from './openapi-document.js';

const require = createRequire(import.meta.url);
const REDOC_BUNDLE = require.resolve('redoc/bundles/redoc.standalone.js');

let application: INestApplication | undefined;

export function rememberDocumentationApp(app: INestApplication): void {
  application = app;
}

const REDOC_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Cocos API</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <redoc spec-url="/openapi.json"></redoc>
    <script type="module" src="/docs/redoc.standalone.js"></script>
  </body>
</html>
`;

@ApiExcludeController()
@Controller()
export class DocsController {
  @Get('openapi.json')
  document() {
    return createOpenApiDocument(requiredApp());
  }

  @Get('docs')
  @Header('content-type', 'text/html; charset=utf-8')
  html(): string {
    return REDOC_HTML;
  }

  @Get('docs/redoc.standalone.js')
  script(@Res() response: Response): void {
    response.sendFile(REDOC_BUNDLE);
  }
}

function requiredApp(): INestApplication {
  if (!application) {
    throw new Error('The HTTP application is not ready to publish OpenAPI.');
  }

  return application;
}
