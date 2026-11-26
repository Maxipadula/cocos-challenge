import type {
  InstrumentId,
  UserId,
} from '../../../shared/domain/value-objects/ids.js';
import { Money } from '../../../shared/domain/value-objects/money.js';
import { ShareQuantity } from '../../../shared/domain/value-objects/share-quantity.js';
import type { UnitPrice } from '../../../shared/domain/value-objects/unit-price.js';
import {
  InvalidOrderTimestampError,
  OrderNotCancellableError,
  OrderSizeRequiredError,
} from '../errors/order-errors.js';
import type { OrderId } from '../value-objects/order-id.js';
import type { RejectionReason } from '../value-objects/rejection-reason.js';

export type TradeSide = 'BUY' | 'SELL';
export type TradeType = 'MARKET' | 'LIMIT';
export type TradeStatus = 'NEW' | 'FILLED' | 'REJECTED' | 'CANCELLED';

type MarketFilled = {
  readonly kind: 'MARKET_FILLED';
  readonly price: UnitPrice;
};
type MarketRejected = {
  readonly kind: 'MARKET_REJECTED';
  readonly price: UnitPrice;
  readonly reason: RejectionReason;
};
type LimitNew = { readonly kind: 'LIMIT_NEW'; readonly price: UnitPrice };
type LimitRejected = {
  readonly kind: 'LIMIT_REJECTED';
  readonly price: UnitPrice;
  readonly reason: RejectionReason;
};
type LimitCancelled = {
  readonly kind: 'LIMIT_CANCELLED';
  readonly price: UnitPrice;
};

type TradeState =
  MarketFilled | MarketRejected | LimitNew | LimitRejected | LimitCancelled;

type TradeOrderProps = {
  readonly id: OrderId;
  readonly userId: UserId;
  readonly instrumentId: InstrumentId;
  readonly side: TradeSide;
  readonly size: ShareQuantity;
  readonly placedAt: Date;
};

export class TradeOrder {
  private constructor(
    readonly id: OrderId,
    readonly userId: UserId,
    readonly instrumentId: InstrumentId,
    readonly side: TradeSide,
    readonly size: ShareQuantity,
    readonly placedAt: Date,
    private readonly state: TradeState,
  ) {}

  static marketFilled(
    props: TradeOrderProps & { readonly price: UnitPrice },
  ): TradeOrder {
    assertOrderSize(props.size);
    return new TradeOrder(
      props.id,
      props.userId,
      props.instrumentId,
      props.side,
      props.size,
      copyDate(props.placedAt),
      { kind: 'MARKET_FILLED', price: props.price },
    );
  }

  static marketRejected(
    props: TradeOrderProps & {
      readonly price: UnitPrice;
      readonly reason: RejectionReason;
    },
  ): TradeOrder {
    assertOrderSize(props.size);
    return new TradeOrder(
      props.id,
      props.userId,
      props.instrumentId,
      props.side,
      props.size,
      copyDate(props.placedAt),
      { kind: 'MARKET_REJECTED', price: props.price, reason: props.reason },
    );
  }

  static limitOpen(
    props: TradeOrderProps & { readonly price: UnitPrice },
  ): TradeOrder {
    assertOrderSize(props.size);
    return new TradeOrder(
      props.id,
      props.userId,
      props.instrumentId,
      props.side,
      props.size,
      copyDate(props.placedAt),
      { kind: 'LIMIT_NEW', price: props.price },
    );
  }

  static limitRejected(
    props: TradeOrderProps & {
      readonly price: UnitPrice;
      readonly reason: RejectionReason;
    },
  ): TradeOrder {
    assertOrderSize(props.size);
    return new TradeOrder(
      props.id,
      props.userId,
      props.instrumentId,
      props.side,
      props.size,
      copyDate(props.placedAt),
      { kind: 'LIMIT_REJECTED', price: props.price, reason: props.reason },
    );
  }

  static limitCancelled(
    props: TradeOrderProps & { readonly price: UnitPrice },
  ): TradeOrder {
    assertOrderSize(props.size);
    return new TradeOrder(
      props.id,
      props.userId,
      props.instrumentId,
      props.side,
      props.size,
      copyDate(props.placedAt),
      { kind: 'LIMIT_CANCELLED', price: props.price },
    );
  }

  get type(): TradeType {
    return this.state.kind.startsWith('MARKET') ? 'MARKET' : 'LIMIT';
  }

  get status(): TradeStatus {
    switch (this.state.kind) {
      case 'MARKET_FILLED':
        return 'FILLED';
      case 'LIMIT_NEW':
        return 'NEW';
      case 'MARKET_REJECTED':
      case 'LIMIT_REJECTED':
        return 'REJECTED';
      case 'LIMIT_CANCELLED':
        return 'CANCELLED';
    }
  }

  get price(): UnitPrice {
    return this.state.price;
  }

  get rejectionReason(): RejectionReason | null {
    if (
      this.state.kind === 'MARKET_REJECTED' ||
      this.state.kind === 'LIMIT_REJECTED'
    ) {
      return this.state.reason;
    }

    return null;
  }

  cancel(): TradeOrder {
    if (this.state.kind !== 'LIMIT_NEW') {
      throw new OrderNotCancellableError();
    }

    return new TradeOrder(
      this.id,
      this.userId,
      this.instrumentId,
      this.side,
      this.size,
      this.placedAt,
      { kind: 'LIMIT_CANCELLED', price: this.state.price },
    );
  }

  settledCashDelta(): Money {
    if (this.state.kind !== 'MARKET_FILLED') {
      return Money.zero(this.state.price.scale);
    }

    const notional = this.state.price.multiply(this.size);
    return this.side === 'BUY' ? notional.negate() : notional;
  }

  committedCash(): Money {
    if (this.state.kind === 'LIMIT_NEW' && this.side === 'BUY') {
      return this.state.price.multiply(this.size);
    }

    return Money.zero(this.state.price.scale);
  }

  settledShares(instrumentId: InstrumentId): bigint {
    if (
      this.instrumentId !== instrumentId ||
      this.state.kind !== 'MARKET_FILLED'
    ) {
      return 0n;
    }

    const size = this.size.toBigInt();
    return this.side === 'BUY' ? size : -size;
  }

  committedShares(instrumentId: InstrumentId): ShareQuantity {
    if (
      this.instrumentId === instrumentId &&
      this.state.kind === 'LIMIT_NEW' &&
      this.side === 'SELL'
    ) {
      return this.size;
    }

    return ShareQuantity.zero();
  }
}

function assertOrderSize(size: ShareQuantity): void {
  if (size.isZero()) {
    throw new OrderSizeRequiredError();
  }
}

function copyDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidOrderTimestampError();
  }

  return new Date(value.getTime());
}
