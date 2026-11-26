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

import { Money } from '#shared/domain/value-objects/money.js';
import { WriteHeadersPipe } from '#shared/presentation/caller-headers.pipe.js';

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

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly submitTradeOrder: SubmitTradeOrder,
    private readonly cancelTradeOrder: CancelTradeOrder,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
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
