import type { Uuid } from '#shared/domain/value-objects/uuid.js';

export type InstrumentInfo = {
  readonly id: Uuid;
  readonly ticker: string;
  readonly name: string;
  readonly type: string;
};

export type MarketDataQuote = {
  readonly instrumentId: Uuid;
  readonly close: string;
  readonly previousClose: string;
  readonly observedAt: string;
};

export abstract class InstrumentQueries {
  abstract findById(id: Uuid): Promise<InstrumentInfo | null>;

  abstract findByTicker(ticker: string): Promise<InstrumentInfo | null>;

  abstract search(
    term: string,
    limit?: number,
  ): Promise<readonly InstrumentInfo[]>;

  abstract latestMarketData(id: Uuid): Promise<MarketDataQuote | null>;

  abstract findByIds(ids: readonly Uuid[]): Promise<readonly InstrumentInfo[]>;

  abstract latestMarketDataFor(
    ids: readonly Uuid[],
  ): Promise<readonly MarketDataQuote[]>;
}
