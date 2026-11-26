import type { IncomingHttpHeaders } from 'node:http';

import {
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Money } from '#shared/domain/value-objects/money.js';
import { WriteHeadersPipe } from '#shared/presentation/caller-headers.pipe.js';

import {
  CancelledOrderResponse,
  ErrorMessageResponse,
  SubmittedOrderResponse,
} from '#docs/http-schemas.js';

import { userId } from '../application/types/user-id.js';
import {
  type CancelledTradeOrder,
  CancelTradeOrder,
} from '../application/use-cases/cancel-trade-order.js';
import {
  type SubmittedTradeOrder,
  SubmitTradeOrder,
} from '../application/use-cases/submit-trade-order.js';
import { instrumentId } from '../domain/value-objects/instrument-id.js';
import { orderId } from '../domain/value-objects/order-id.js';
import { ShareQuantity } from '../domain/value-objects/share-quantity.js';
import { UnitPrice } from '../domain/value-objects/unit-price.js';
import { CancelOrderParams } from './cancel-order.params.js';
import { SubmitOrderDto } from './submit-order.dto.js';

const USER_HEADER = {
  name: 'X-User-Id',
  required: true,
  description: 'UUID of the user who owns the account. There is no authentication.',
  schema: { type: 'string', format: 'uuid' },
  example: 'a1000000-0000-4000-8000-000000000001',
} as const;

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'Opaque client key, up to 255 characters. The same key and the same request return the stored result. The same key with a different request returns 409.',
  schema: { type: 'string', maxLength: 255 },
} as const;

const GGAL = 'a3000000-0000-4000-8000-000000000022';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly submitTradeOrder: SubmitTradeOrder,
    private readonly cancelTradeOrder: CancelTradeOrder,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a trade order',
    description:
      'MARKET orders are filled immediately at the latest close, or stored as REJECTED when available cash or shares are insufficient. Accepted LIMIT orders stay NEW and reserve the cash (BUY) or the shares (SELL). A rejected order is still persisted and this endpoint returns 201. There is no LIMIT execution or matching, and no cash-movement endpoint.',
  })
  @ApiHeader(USER_HEADER)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiBody({
    type: SubmitOrderDto,
    examples: {
      marketBuy: {
        summary: 'MARKET BUY by quantity',
        value: {
          instrumentId: GGAL,
          side: 'BUY',
          type: 'MARKET',
          quantity: '2',
        },
      },
      marketSell: {
        summary: 'MARKET SELL by quantity',
        value: {
          instrumentId: GGAL,
          side: 'SELL',
          type: 'MARKET',
          quantity: '2',
        },
      },
      limitBuy: {
        summary: 'LIMIT BUY by amount',
        value: {
          instrumentId: GGAL,
          side: 'BUY',
          type: 'LIMIT',
          amount: '1000.00',
          limitPrice: '100.00',
        },
      },
      limitSell: {
        summary: 'LIMIT SELL by quantity',
        value: {
          instrumentId: GGAL,
          side: 'SELL',
          type: 'LIMIT',
          quantity: '4',
          limitPrice: '100.00',
        },
      },
    },
  })
  @ApiCreatedResponse({
    type: SubmittedOrderResponse,
    description:
      'The order was stored. status is FILLED for an accepted market order, NEW for an accepted limit order, and REJECTED when funds or shares are insufficient.',
  })
  @ApiResponse({
    status: 400,
    description:
      'The body or headers are invalid, quantity and amount are both present or both absent, the amount cannot buy one share, or a decimal is not persistable.',
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
    status: 422,
    description:
      'The instrument does not exist, it is a currency, or a MARKET order has no latest close.',
    type: ErrorMessageResponse,
  })
  @ApiResponse({ status: 500, description: 'Unexpected server error.', type: ErrorMessageResponse })
  async submit(
    @Headers() headers: IncomingHttpHeaders,
    @Body() body: SubmitOrderDto,
  ): Promise<SubmittedTradeOrder> {
    const caller = await new WriteHeadersPipe().transform(headers);
    const identity = {
      userId: userId(caller.userId),
      idempotencyKey: caller.idempotencyKey,
      instrumentId: instrumentId(body.instrumentId),
      side: body.side,
      sizing:
        body.quantity !== undefined
          ? {
              kind: 'QUANTITY' as const,
              quantity: ShareQuantity.of(BigInt(body.quantity)),
            }
          : {
              kind: 'AMOUNT' as const,
              amount: Money.parse(body.amount ?? ''),
            },
    };

    if (body.type === 'MARKET') {
      return this.submitTradeOrder.execute({ ...identity, type: 'MARKET' });
    }

    return this.submitTradeOrder.execute({
      ...identity,
      type: 'LIMIT',
      limitPrice: UnitPrice.parse(body.limitPrice ?? ''),
    });
  }

  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a new limit order',
    description:
      'Cancels a LIMIT order that is still NEW and releases the cash or shares it reserved. Replaying the same Idempotency-Key returns the stored cancellation. A different key for an order that is no longer NEW returns 409 and does not release the reservation again.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiHeader(USER_HEADER)
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ type: CancelledOrderResponse })
  @ApiResponse({
    status: 400,
    description: 'orderId or a required header is invalid.',
    type: ErrorMessageResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'The order does not exist for this account, or the user has no account.',
    type: ErrorMessageResponse,
    example: { message: 'Order was not found.' },
  })
  @ApiResponse({
    status: 409,
    description:
      'The order is not a LIMIT order in status NEW, or Idempotency-Key was reused with a different order.',
    type: ErrorMessageResponse,
    example: { message: 'Only a new limit order can be cancelled.' },
  })
  @ApiResponse({ status: 500, description: 'Unexpected server error.', type: ErrorMessageResponse })
  async cancel(
    @Headers() headers: IncomingHttpHeaders,
    @Param() params: CancelOrderParams,
  ): Promise<CancelledTradeOrder> {
    const caller = await new WriteHeadersPipe().transform(headers);
    const result = await this.cancelTradeOrder.execute({
      userId: userId(caller.userId),
      orderId: orderId(params.orderId),
      idempotencyKey: caller.idempotencyKey,
    });

    if (result.outcome === 'NOT_FOUND') {
      throw new NotFoundException('Order was not found.');
    }

    if (result.outcome === 'NOT_CANCELLABLE') {
      throw new ConflictException('Only a new limit order can be cancelled.');
    }

    return result.order;
  }
}
