import { describe, expect, it } from 'vitest';

import { InvalidPortfolioQuantityError } from '#portfolio/domain/errors/invalid-portfolio-quantity.error.js';
import {
  dailyReturnPercentage,
  valuePortfolio,
} from '#portfolio/domain/services/value-portfolio.js';

const stock = '00000000-0000-4000-8000-000000000014';
const other = '00000000-0000-4000-8000-000000000015';

describe('valuePortfolio', () => {
  it('values settled holdings and keeps reserved cash inside the total', () => {
    const portfolio = valuePortfolio({
      settledCash: '1000.00',
      reservedCash: '150.00',
      availableCash: '850.00',
      positions: [
        {
          instrumentId: stock,
          ticker: 'GGAL',
          name: 'Grupo Galicia',
          quantity: '4',
          reservedQuantity: '1',
          availableQuantity: '3',
          quote: { close: '10.50', previousClose: '10.00' },
        },
      ],
    });

    expect(portfolio.reservedCash).toBe('150.00');
    expect(portfolio.availableCash).toBe('850.00');
    expect(portfolio.positions[0]?.marketValue).toBe('42.00');
    expect(portfolio.positions[0]?.reservedQuantity).toBe('1');
    expect(portfolio.positions[0]?.availableQuantity).toBe('3');
    expect(portfolio.positions[0]?.dailyReturnPercentage).toBe('5.0000');
    expect(portfolio.totalValue).toBe('1042.00');
  });

  it('keeps a negative available cash and values only settled shares', () => {
    const portfolio = valuePortfolio({
      settledCash: '1000',
      reservedCash: '1500',
      availableCash: '-500',
      positions: [
        {
          instrumentId: stock,
          ticker: 'GGAL',
          name: 'Grupo Galicia',
          quantity: '0',
          reservedQuantity: '6',
          availableQuantity: '0',
          quote: { close: '10', previousClose: '10' },
        },
      ],
    });

    expect(portfolio.availableCash).toBe('-500');
    expect(portfolio.positions[0]?.quantity).toBe('0');
    expect(portfolio.positions[0]?.marketValue).toBe('0');
    expect(portfolio.totalValue).toBe('1000');
  });

  it('operates on cash and quantities beyond the persistable limits', () => {
    const settled = (10n ** 21n).toString();
    const quantity = (10n ** 20n).toString();
    const portfolio = valuePortfolio({
      settledCash: settled,
      reservedCash: '1',
      availableCash: (10n ** 21n - 1n).toString(),
      positions: [
        {
          instrumentId: stock,
          ticker: 'GGAL',
          name: 'Grupo Galicia',
          quantity,
          reservedQuantity: '0',
          availableQuantity: quantity,
          quote: { close: '2', previousClose: '1' },
        },
        {
          instrumentId: other,
          ticker: 'YPF',
          name: 'YPF',
          quantity: '-4',
          reservedQuantity: '2',
          availableQuantity: '0',
          quote: { close: '10.50', previousClose: '10.50' },
        },
      ],
    });

    expect(portfolio.availableCash).toBe((10n ** 21n - 1n).toString());
    expect(portfolio.positions[1]?.availableQuantity).toBe('0');
    expect(portfolio.positions[1]?.reservedQuantity).toBe('2');
    expect(portfolio.positions[0]?.marketValue).toBe(
      (2n * 10n ** 20n).toString(),
    );
    expect(portfolio.positions[1]?.marketValue).toBe('-42.00');
    expect(portfolio.totalValue).toBe(
      `${(10n ** 21n + 2n * 10n ** 20n - 42n).toString()}.00`,
    );
  });

  it('keeps a position without a quote and leaves the account total unknown', () => {
    const portfolio = valuePortfolio({
      settledCash: '10.00',
      reservedCash: '0',
      availableCash: '10.00',
      positions: [
        {
          instrumentId: stock,
          ticker: 'GGAL',
          name: 'Grupo Galicia',
          quantity: '2',
          reservedQuantity: '0',
          availableQuantity: '2',
          quote: null,
        },
        {
          instrumentId: other,
          ticker: 'YPF',
          name: 'YPF',
          quantity: '1',
          reservedQuantity: '0',
          availableQuantity: '1',
          quote: { close: '5.00', previousClose: '4.00' },
        },
      ],
    });

    expect(portfolio.positions[0]).toMatchObject({
      ticker: 'GGAL',
      name: 'Grupo Galicia',
      quantity: '2',
      reservedQuantity: '0',
      availableQuantity: '2',
      close: null,
      marketValue: null,
      dailyReturnPercentage: null,
    });
    expect(portfolio.positions[1]?.marketValue).toBe('5.00');
    expect(portfolio.totalValue).toBeNull();
    expect(portfolio.availableCash).toBe('10.00');
  });

  it('returns a null daily return when the previous close is zero', () => {
    const portfolio = valuePortfolio({
      settledCash: '0',
      reservedCash: '0',
      availableCash: '0',
      positions: [
        {
          instrumentId: stock,
          ticker: 'GGAL',
          name: 'Grupo Galicia',
          quantity: '2',
          reservedQuantity: '0',
          availableQuantity: '2',
          quote: { close: '10.00', previousClose: '0.00' },
        },
      ],
    });

    expect(portfolio.positions[0]?.dailyReturnPercentage).toBeNull();
    expect(portfolio.positions[0]?.marketValue).toBe('20.00');
    expect(portfolio.totalValue).toBe('20.00');
  });

  it('rejects a fractional quantity', () => {
    expect(() =>
      valuePortfolio({
        settledCash: '0',
        reservedCash: '0',
        availableCash: '0',
        positions: [
          {
            instrumentId: stock,
            ticker: 'GGAL',
            name: 'Grupo Galicia',
            quantity: '1.5',
            reservedQuantity: '0',
            availableQuantity: '0',
            quote: { close: '10', previousClose: '10' },
          },
        ],
      }),
    ).toThrow(InvalidPortfolioQuantityError);
  });
});

describe('dailyReturnPercentage', () => {
  it('rounds half up with four decimal places', () => {
    expect(dailyReturnPercentage('2000001', '2000000')).toBe('0.0001');
    expect(dailyReturnPercentage('1999999', '2000000')).toBe('-0.0001');
    expect(dailyReturnPercentage('3000001', '3000000')).toBe('0.0000');
    expect(dailyReturnPercentage('101.5', '100')).toBe('1.5000');
    expect(dailyReturnPercentage('10', '0')).toBeNull();
    expect(dailyReturnPercentage('10', '0.00')).toBeNull();
  });
});
