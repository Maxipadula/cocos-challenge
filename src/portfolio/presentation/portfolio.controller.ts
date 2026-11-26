import type { IncomingHttpHeaders } from 'node:http';

import { Controller, Get, Headers } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { uuid } from '#shared/domain/value-objects/uuid.js';
import { UserHeaderPipe } from '#shared/presentation/caller-headers.pipe.js';

import { ErrorMessageResponse, PortfolioResponse } from '#docs/http-schemas.js';

import { GetPortfolio } from '../application/use-cases/get-portfolio.js';

@ApiTags('portfolio')
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly getPortfolio: GetPortfolio) {}

  @Get()
  @ApiOperation({
    summary: 'Read a portfolio',
    description:
      'Returns settled cash, reserved cash, available cash, total value, and share positions for the account of X-User-Id. Reservations are not subtracted from the total. Cash movements are not returned as positions.',
  })
  @ApiHeader({
    name: 'X-User-Id',
    required: true,
    description: 'UUID of the user whose account is read. There is no authentication.',
    schema: { type: 'string', format: 'uuid' },
    example: 'a1000000-0000-4000-8000-000000000001',
  })
  @ApiOkResponse({ type: PortfolioResponse })
  @ApiResponse({
    status: 400,
    description: 'X-User-Id is missing or is not a UUID.',
    type: ErrorMessageResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'The user has no investment account.',
    type: ErrorMessageResponse,
    example: { message: 'Portfolio account was not found.' },
  })
  @ApiResponse({
    status: 500,
    description:
      'A position references a missing instrument or a currency instrument, or another unexpected error occurred.',
    type: ErrorMessageResponse,
  })
  async show(@Headers() headers: IncomingHttpHeaders) {
    const caller = await new UserHeaderPipe().transform(headers);

    return this.getPortfolio.execute(uuid(caller.userId));
  }
}
