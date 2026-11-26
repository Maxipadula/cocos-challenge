import { Money } from '#shared/domain/value-objects/money.js';

import { TradeOrder } from '../entities/trade-order.js';
import type { InstrumentId } from '../value-objects/instrument-id.js';
import type { AccountEntry } from './availability.js';

export type AccountHolding = {
  readonly instrumentId: InstrumentId;
  readonly quantity: bigint;
};

export type AccountHoldings = {
  readonly settledCash: Money;
  readonly committedCash: Money;
  readonly positions: readonly AccountHolding[];
};

export function accountHoldings(
  entries: readonly AccountEntry[],
): AccountHoldings {
  let settledCash = Money.zero();
  let committedCash = Money.zero();
  const quantities = new Map<InstrumentId, bigint>();

  for (const entry of entries) {
    settledCash = settledCash.add(entry.settledCashDelta());
    committedCash = committedCash.add(entry.committedCash());

    if (!(entry instanceof TradeOrder)) {
      continue;
    }

    const quantity = quantities.get(entry.instrumentId) ?? 0n;
    quantities.set(
      entry.instrumentId,
      quantity + entry.settledShares(entry.instrumentId),
    );
  }

  const positions = [...quantities.entries()]
    .filter(([, quantity]) => quantity !== 0n)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([instrumentId, quantity]) => ({ instrumentId, quantity }));

  return { settledCash, committedCash, positions };
}
