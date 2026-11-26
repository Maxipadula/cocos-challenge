import type { IncomingHttpHeaders } from 'node:http';

import { Controller, Get, Headers } from '@nestjs/common';

import { uuid } from '#shared/domain/value-objects/uuid.js';
import { UserHeaderPipe } from '#shared/presentation/caller-headers.pipe.js';

import { GetPortfolio } from '../application/use-cases/get-portfolio.js';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly getPortfolio: GetPortfolio) {}

  @Get()
  async show(@Headers() headers: IncomingHttpHeaders) {
    const caller = await new UserHeaderPipe().transform(headers);

    return this.getPortfolio.execute(uuid(caller.userId));
  }
}
