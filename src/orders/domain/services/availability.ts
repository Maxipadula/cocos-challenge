import { Money } from '../../../shared/domain/value-objects/money.js';
import { ShareQuantity } from '../../../shared/domain/value-objects/share-quantity.js';
import type { InstrumentId } from '../../../shared/domain/value-objects/ids.js';
import type { CashMovement } from '../entities/cash-movement.js';
import { TradeOrder } from '../entities/trade-order.js';

export type AccountEntry = TradeOrder | CashMovement;

export function availableCash(entries: readonly AccountEntry[]): Money {
  return entries.reduce(
    (total, entry) =>
      total.add(entry.settledCashDelta()).subtract(entry.committedCash()),
    Money.zero(),
  );
}

export function availableShares(
  entries: readonly AccountEntry[],
  instrumentId: InstrumentId,
): ShareQuantity {
  const settled = entries.reduce(
    (total, entry) =>
      entry instanceof TradeOrder
        ? total + entry.settledShares(instrumentId)
        : total,
    0n,
  );
  const committed = entries.reduce(
    (total, entry) =>
      entry instanceof TradeOrder
        ? total + entry.committedShares(instrumentId).toBigInt()
        : total,
    0n,
  );
  const available = settled - committed;

  if (available < 0n) {
    return ShareQuantity.zero();
  }

  return ShareQuantity.of(available);
}
