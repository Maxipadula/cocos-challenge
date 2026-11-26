import { describe, expect, it } from 'vitest';

import { challengeFixtureId } from '../../../src/seed/fixture-id.js';
import { transformChallengeFixture } from '../../../src/seed/transform-challenge-fixture.js';

describe('transformChallengeFixture', () => {
  const plan = transformChallengeFixture();

  it('keeps the four users, their accounts and all 66 instruments', () => {
    expect(plan.users.map((user) => user.email)).toEqual([
      'emiliano@test.com',
      'jose@test.com',
      'francisco@test.com',
      'juan@test.com',
    ]);
    expect(plan.accounts.map((account) => account.accountNumber)).toEqual([
      '10001',
      '10002',
      '10003',
      '10004',
    ]);
    expect(plan.instruments).toHaveLength(66);
    expect(
      plan.instruments.find((instrument) => instrument.ticker === 'ARS'),
    ).toMatchObject({
      type: 'MONEDA',
      id: challengeFixtureId('instrument', 66),
    });
    expect(plan.users[0]?.id.startsWith('a1000000-')).toBe(true);
    expect(plan.users[0]?.id.startsWith('00000000-')).toBe(false);
  });

  it('imports 124 quotes and documents the omitted and rounded rows', () => {
    expect(plan.marketData).toHaveLength(124);
    expect(
      plan.marketData.some(
        (quote) =>
          quote.instrumentId === challengeFixtureId('instrument', 12) &&
          quote.observedAt.toISOString() === '2023-07-13T00:00:00.000Z',
      ),
    ).toBe(false);
    expect(
      plan.marketData.some(
        (quote) =>
          quote.instrumentId === challengeFixtureId('instrument', 53) &&
          quote.observedAt.toISOString() === '2023-07-13T00:00:00.000Z',
      ),
    ).toBe(false);
    expect(
      plan.marketData.find(
        (quote) =>
          quote.instrumentId === challengeFixtureId('instrument', 22) &&
          quote.observedAt.toISOString() === '2023-07-14T00:00:00.000Z',
      )?.previousClose,
    ).toBe('1047.17');
    expect(
      plan.deviations.filter((item) => item.code === 'OMIT_NULL_OHLC'),
    ).toHaveLength(2);
    expect(
      plan.deviations.some((item) => item.detail.includes('1047.166')),
    ).toBe(true);
  });

  it('drops the filled limit order and normalizes cash and the rejected sell', () => {
    expect(plan.orders).toHaveLength(10);
    expect(
      plan.orders.some((order) => order.id === challengeFixtureId('order', 9)),
    ).toBe(false);
    expect(
      plan.deviations.some((item) => item.code === 'OMIT_LIMIT_FILLED'),
    ).toBe(true);

    const cash = plan.orders.filter(
      (order) => order.side === 'CASH_IN' || order.side === 'CASH_OUT',
    );
    expect(
      cash.map((order) => [order.side, order.size, order.type, order.price]),
    ).toEqual([
      ['CASH_IN', '1000000', null, null],
      ['CASH_OUT', '100000', null, null],
    ]);
    expect(
      plan.orders.find((order) => order.id === challengeFixtureId('order', 6)),
    ).toMatchObject({
      side: 'SELL',
      status: 'REJECTED',
      rejectionReason: 'INSUFFICIENT_SHARES',
    });
    expect(
      plan.orders.every((order) => order.placedAt.toISOString().endsWith('Z')),
    ).toBe(true);
  });
});
