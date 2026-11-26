import type { IncomingHttpHeaders } from 'node:http';

import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { WriteHeadersPipe } from '#shared/presentation/caller-headers.pipe.js';

import {
  ErrorMessageResponse,
  SubmittedCashMovementResponse,
} from '#docs/http-schemas.js';

import { userId } from '../application/types/user-id.js';
import {
  SubmitCashMovement,
  type SubmittedCashMovement,
} from '../application/use-cases/submit-cash-movement.js';
import { SubmitCashMovementDto } from './submit-cash-movement.dto.js';

@ApiTags('cash-movements')
@Controller('cash-movements')
export class CashMovementsController {
  constructor(private readonly submitCashMovement: SubmitCashMovement) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record a cash deposit or withdrawal',
    description:
      'CASH_IN is stored as FILLED and increases settled cash. CASH_OUT is stored as FILLED when the amount fits in available cash, or as REJECTED with INSUFFICIENT_CASH when it does not. Reserved cash cannot be withdrawn. A rejected withdrawal is still persisted and this endpoint returns 201. The ARS instrument is chosen by the server.',
  })
  @ApiHeader({
    name: 'X-User-Id',
    required: true,
    description: 'UUID of the user who owns the account. There is no authentication.',
    schema: { type: 'string', format: 'uuid' },
    example: 'a1000000-0000-4000-8000-000000000001',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Opaque client key, up to 255 characters. The same key and the same request return the stored result. The same key with a different request returns 409.',
    schema: { type: 'string', maxLength: 255 },
  })
  @ApiBody({
    type: SubmitCashMovementDto,
    examples: {
      cashIn: {
        summary: 'Deposit',
        value: { side: 'CASH_IN', amount: '1500.50' },
      },
      cashOut: {
        summary: 'Withdrawal',
        value: { side: 'CASH_OUT', amount: '500.00' },
      },
    },
  })
  @ApiCreatedResponse({
    type: SubmittedCashMovementResponse,
    description:
      'The movement was stored. status is FILLED when it settled, and REJECTED when a withdrawal exceeds available cash.',
  })
  @ApiResponse({
    status: 400,
    description:
      'The body or headers are invalid, the amount is not a positive decimal string, or an unknown field was sent.',
    type: ErrorMessageResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'The user has no investment account.',
    type: ErrorMessageResponse,
    example: { message: 'Investment account was not found.' },
  })
  @ApiResponse({
    status: 409,
    description: 'Idempotency-Key was reused with a different request.',
    type: ErrorMessageResponse,
    example: { message: 'Idempotency key was reused with a different request.' },
  })
  @ApiResponse({
    status: 500,
    description: 'The ARS currency instrument is missing, or another unexpected error occurred.',
    type: ErrorMessageResponse,
  })
  async submit(
    @Headers() headers: IncomingHttpHeaders,
    @Body() body: SubmitCashMovementDto,
  ): Promise<SubmittedCashMovement> {
    const caller = await new WriteHeadersPipe().transform(headers);

    return this.submitCashMovement.execute({
      userId: userId(caller.userId),
      side: body.side,
      amount: body.amount,
      idempotencyKey: caller.idempotencyKey,
    });
  }
}
