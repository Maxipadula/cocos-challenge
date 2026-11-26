import { describe, expect, it, vi } from 'vitest';

import { uuid } from '#shared/domain/value-objects/uuid.js';

import {
  type InstrumentInfo,
  InstrumentQueries,
  type MarketDataQuote,
} from '#instruments/application/instrument-queries.js';
import {
  type AccountPortfolioSnapshot,
  OrdersPortfolioDataProvider,
} from '#orders/application/orders-portfolio-data.js';
import { PortfolioAccountNotFoundError } from '#portfolio/application/errors/portfolio-account-not-found.error.js';
import { PortfolioCurrencyPositionError } from '#portfolio/application/errors/portfolio-currency-position.error.js';
import { PortfolioInstrumentMissingError } from '#portfolio/application/errors/portfolio-instrument-missing.error.js';
import { GetPortfolio } from '#portfolio/application/use-cases/get-portfolio.js';

const user = uuid('00000000-0000-4000-8000-000000000007');
const account = uuid('00000000-0000-4000-8000-000000000003');
const stock = uuid('00000000-0000-4000-8000-000000000014');
const other = uuid('00000000-0000-4000-8000-000000000015');

class FakeOrders extends OrdersPortfolioDataProvider {
  constructor(private readonly snapshot: AccountPortfolioSnapshot | null) {
    super();
  }

  override findByUserId(): Promise<AccountPortfolioSnapshot | null> {
    return Promise.resolve(this.snapshot);
  }
}

class FakeInstruments extends InstrumentQueries {
  findByIds = vi.fn((): Promise<readonly InstrumentInfo[]> =>
    Promise.resolve(this.rows),
  );

  latestMarketDataFor = vi.fn((): Promise<readonly MarketDataQuote[]> =>
    Promise.resolve(this.quotes),
  );

  constructor(
    private readonly rows: readonly InstrumentInfo[] = [],
    private readonly quotes: readonly MarketDataQuote[] = [],
  ) {
    super();
  }

  override findById(): Promise<InstrumentInfo | null> {
    return Promise.resolve(null);
  }

  override search(): Promise<readonly InstrumentInfo[]> {
    return Promise.resolve([]);
  }

  override latestMarketData(): Promise<MarketDataQuote | null> {
    return Promise.resolve(null);
  }
}

function snapshot(
  positions: AccountPortfolioSnapshot['positions'] = [],
  cash: Partial<
    Pick<AccountPortfolioSnapshot, 'settledCash' | 'committedCash'>
  > = {},
): AccountPortfolioSnapshot {
  return {
    accountId: account,
    settledCash: cash.settledCash ?? '0',
    committedCash: cash.committedCash ?? '0',
    positions,
  };
}

describe('GetPortfolio', () => {
  it('fails when the user has no account', async () => {
    const instruments = new FakeInstruments();
    const portfolio = new GetPortfolio(new FakeOrders(null), instruments);

    await expect(portfolio.execute(user)).rejects.toBeInstanceOf(
      PortfolioAccountNotFoundError,
    );
    expect(instruments.findByIds).not.toHaveBeenCalled();
  });

  it('does not query instruments for an account without positions', async () => {
    const instruments = new FakeInstruments();
    const portfolio = new GetPortfolio(
      new FakeOrders(
        snapshot([], { settledCash: '25.00', committedCash: '5.00' }),
      ),
      instruments,
    );

    await expect(portfolio.execute(user)).resolves.toEqual({
      accountId: account,
      settledCash: '25.00',
      availableCash: '20.00',
      totalValue: '25.00',
      positions: [],
    });
    expect(instruments.findByIds).not.toHaveBeenCalled();
    expect(instruments.latestMarketDataFor).not.toHaveBeenCalled();
  });

  it('fails when a held instrument does not exist', async () => {
    const instruments = new FakeInstruments([
      { id: stock, ticker: 'GGAL', name: 'Grupo Galicia', type: 'ACCIONES' },
    ]);
    const portfolio = new GetPortfolio(
      new FakeOrders(
        snapshot([
          { instrumentId: other, quantity: '1' },
          { instrumentId: stock, quantity: '2' },
        ]),
      ),
      instruments,
    );

    await expect(portfolio.execute(user)).rejects.toEqual(
      expect.objectContaining({
        name: 'PortfolioInstrumentMissingError',
        instrumentIds: [other],
      }),
    );
    await expect(portfolio.execute(user)).rejects.toBeInstanceOf(
      PortfolioInstrumentMissingError,
    );
  });

  it('keeps a position without a quote and reports an unknown total', async () => {
    const instruments = new FakeInstruments([
      { id: stock, ticker: 'GGAL', name: 'Grupo Galicia', type: 'ACCIONES' },
    ]);
    const portfolio = new GetPortfolio(
      new FakeOrders(
        snapshot([{ instrumentId: stock, quantity: '3' }], {
          settledCash: '10.00',
        }),
      ),
      instruments,
    );

    const result = await portfolio.execute(user);

    expect(result.positions).toEqual([
      {
        instrumentId: stock,
        ticker: 'GGAL',
        name: 'Grupo Galicia',
        quantity: '3',
        close: null,
        marketValue: null,
        dailyReturnPercentage: null,
      },
    ]);
    expect(result.totalValue).toBeNull();
    expect(result.availableCash).toBe('10.00');
  });

  it('returns a null daily return when the previous close is zero', async () => {
    const instruments = new FakeInstruments(
      [{ id: stock, ticker: 'GGAL', name: 'Grupo Galicia', type: 'ACCIONES' }],
      [
        {
          instrumentId: stock,
          close: '10.00',
          previousClose: '0',
          observedAt: '2026-01-16T00:00:00.000Z',
        },
      ],
    );
    const portfolio = new GetPortfolio(
      new FakeOrders(snapshot([{ instrumentId: stock, quantity: '2' }])),
      instruments,
    );

    const result = await portfolio.execute(user);

    expect(result.positions[0]?.dailyReturnPercentage).toBeNull();
    expect(result.positions[0]?.marketValue).toBe('20.00');
    expect(result.totalValue).toBe('20.00');
  });

  it('fails when a position references a currency instrument', async () => {
    const instruments = new FakeInstruments([
      { id: stock, ticker: 'ARS', name: 'Peso argentino', type: 'MONEDA' },
    ]);
    const portfolio = new GetPortfolio(
      new FakeOrders(snapshot([{ instrumentId: stock, quantity: '1' }])),
      instruments,
    );

    await expect(portfolio.execute(user)).rejects.toBeInstanceOf(
      PortfolioCurrencyPositionError,
    );
  });

  it('values a large signed quantity with the real calculation', async () => {
    const quantity = (10n ** 20n).toString();
    const instruments = new FakeInstruments(
      [{ id: stock, ticker: 'GGAL', name: 'Grupo Galicia', type: 'ACCIONES' }],
      [
        {
          instrumentId: stock,
          close: '2',
          previousClose: '2',
          observedAt: '2026-01-16T00:00:00.000Z',
        },
      ],
    );
    const portfolio = new GetPortfolio(
      new FakeOrders(
        snapshot([{ instrumentId: stock, quantity }], {
          settledCash: (10n ** 21n).toString(),
          committedCash: '0',
        }),
      ),
      instruments,
    );

    const result = await portfolio.execute(user);

    expect(result.positions[0]?.quantity).toBe(quantity);
    expect(result.positions[0]?.marketValue).toBe((2n * 10n ** 20n).toString());
    expect(result.totalValue).toBe((10n ** 21n + 2n * 10n ** 20n).toString());
    expect(result.positions[0]?.dailyReturnPercentage).toBe('0.0000');
  });
});
