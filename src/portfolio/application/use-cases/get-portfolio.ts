import type { Uuid } from '#shared/domain/value-objects/uuid.js';

import type { InstrumentQueries } from '#instruments/application/instrument-queries.js';
import type {
  AccountPortfolioSnapshot,
  OrdersPortfolioDataProvider,
} from '#orders/application/orders-portfolio-data.js';

import {
  type PortfolioPosition,
  type PortfolioValuation,
  valuePortfolio,
} from '../../domain/services/value-portfolio.js';
import { PortfolioAccountNotFoundError } from '../errors/portfolio-account-not-found.error.js';
import { PortfolioCurrencyPositionError } from '../errors/portfolio-currency-position.error.js';
import { PortfolioInstrumentMissingError } from '../errors/portfolio-instrument-missing.error.js';

export type Portfolio = {
  readonly accountId: string;
  readonly settledCash: string;
  readonly reservedCash: string;
  readonly availableCash: string;
  readonly totalValue: string | null;
  readonly positions: readonly PortfolioPosition[];
};

export class GetPortfolio {
  constructor(
    private readonly orders: OrdersPortfolioDataProvider,
    private readonly instruments: InstrumentQueries,
  ) {}

  async execute(userId: Uuid): Promise<Portfolio> {
    const snapshot = await this.orders.findByUserId(userId);

    if (!snapshot) {
      throw new PortfolioAccountNotFoundError();
    }

    if (snapshot.positions.length === 0) {
      return portfolioOf(
        snapshot,
        valuePortfolio({
          settledCash: snapshot.settledCash,
          reservedCash: snapshot.reservedCash,
          availableCash: snapshot.availableCash,
          positions: [],
        }),
      );
    }

    const ids = snapshot.positions.map((position) => position.instrumentId);
    const [instruments, quotes] = await Promise.all([
      this.instruments.findByIds(ids),
      this.instruments.latestMarketDataFor(ids),
    ]);
    const described = new Map(
      instruments.map((instrument) => [instrument.id, instrument]),
    );
    const missing = ids.filter((id) => !described.has(id)).sort();

    if (missing.length > 0) {
      throw new PortfolioInstrumentMissingError(missing);
    }

    const quoted = new Map(quotes.map((quote) => [quote.instrumentId, quote]));

    return portfolioOf(
      snapshot,
      valuePortfolio({
        settledCash: snapshot.settledCash,
        reservedCash: snapshot.reservedCash,
        availableCash: snapshot.availableCash,
        positions: snapshot.positions.map((position) => {
          const instrument = described.get(position.instrumentId);

          if (!instrument) {
            throw new PortfolioInstrumentMissingError([position.instrumentId]);
          }

          if (instrument.type === 'MONEDA') {
            throw new PortfolioCurrencyPositionError(instrument.id);
          }

          return {
            instrumentId: position.instrumentId,
            ticker: instrument.ticker,
            name: instrument.name,
            quantity: position.quantity,
            reservedQuantity: position.reservedQuantity,
            availableQuantity: position.availableQuantity,
            quote: quoted.get(position.instrumentId) ?? null,
          };
        }),
      }),
    );
  }
}

function portfolioOf(
  snapshot: AccountPortfolioSnapshot,
  valuation: PortfolioValuation,
): Portfolio {
  return {
    accountId: snapshot.accountId,
    settledCash: valuation.settledCash,
    reservedCash: valuation.reservedCash,
    availableCash: valuation.availableCash,
    totalValue: valuation.totalValue,
    positions: valuation.positions,
  };
}
