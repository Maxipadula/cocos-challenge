import {
  challengeInstruments,
  type ChallengeMarketRow,
  challengeMarketRows,
  type ChallengeOrder,
  challengeOrders,
  challengeUsers,
} from './challenge-source.js';
import { challengeFixtureId } from './fixture-id.js';

export type SeedDeviation = {
  readonly code:
    | 'OMIT_NULL_OHLC'
    | 'OMIT_LIMIT_FILLED'
    | 'CASH_WITHOUT_PRICE'
    | 'INFERRED_REJECTION_REASON'
    | 'ROUND_NUMERIC_10_2'
    | 'UTC_CLOCK';
  readonly detail: string;
};

export type SeedUser = {
  readonly id: string;
  readonly email: string;
};

export type SeedAccount = {
  readonly id: string;
  readonly userId: string;
  readonly accountNumber: string;
};

export type SeedInstrument = {
  readonly id: string;
  readonly ticker: string;
  readonly name: string;
  readonly type: string;
};

export type SeedMarketData = {
  readonly id: string;
  readonly instrumentId: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly previousClose: string;
  readonly observedAt: Date;
};

export type SeedOrder = {
  readonly id: string;
  readonly accountId: string;
  readonly instrumentId: string;
  readonly side: ChallengeOrder['side'];
  readonly size: string;
  readonly price: string | null;
  readonly type: ChallengeOrder['type'] | null;
  readonly status: ChallengeOrder['status'];
  readonly rejectionReason: 'INSUFFICIENT_CASH' | 'INSUFFICIENT_SHARES' | null;
  readonly placedAt: Date;
};

export type DevelopmentSeedPlan = {
  readonly users: readonly SeedUser[];
  readonly accounts: readonly SeedAccount[];
  readonly instruments: readonly SeedInstrument[];
  readonly marketData: readonly SeedMarketData[];
  readonly orders: readonly SeedOrder[];
  readonly deviations: readonly SeedDeviation[];
};

const UTC =
  'Timestamps and dates in the original script have no time zone. The seed stores those clock digits as UTC.';

export function transformChallengeFixture(): DevelopmentSeedPlan {
  const deviations: SeedDeviation[] = [{ code: 'UTC_CLOCK', detail: UTC }];
  const instrumentBySerial = new Map(
    challengeInstruments.map((instrument) => [instrument.serial, instrument]),
  );
  const userBySerial = new Map(
    challengeUsers.map((user) => [user.serial, user]),
  );

  const instruments = challengeInstruments.map((instrument) => ({
    id: challengeFixtureId('instrument', instrument.serial),
    ticker: instrument.ticker,
    name: instrument.name,
    type: instrument.type,
  }));

  const marketData = challengeMarketRows.flatMap((row) => {
    const instrument = requiredInstrument(
      instrumentBySerial,
      row.instrumentSerial,
    );

    if (row.open === null || row.high === null || row.low === null) {
      deviations.push({
        code: 'OMIT_NULL_OHLC',
        detail: `Omitted ${instrument.ticker} on ${row.date} because open, high or low is null.`,
      });
      return [];
    }

    const prices = {
      open: numeric10Scale2(row.open),
      high: numeric10Scale2(row.high),
      low: numeric10Scale2(row.low),
      close: numeric10Scale2(row.close),
      previousClose: numeric10Scale2(row.previousClose),
    };

    for (const [field, original] of [
      ['open', row.open],
      ['high', row.high],
      ['low', row.low],
      ['close', row.close],
      ['previousClose', row.previousClose],
    ] as const) {
      if (significantFraction(original).length > 2) {
        deviations.push({
          code: 'ROUND_NUMERIC_10_2',
          detail: `${instrument.ticker} ${row.date} ${field} ${original} is stored as ${prices[field]} to match NUMERIC(10, 2).`,
        });
      }
    }

    return [
      {
        id: challengeFixtureId('marketData', row.serial),
        instrumentId: challengeFixtureId('instrument', instrument.serial),
        ...prices,
        observedAt: utcDate(row.date),
      },
    ];
  });

  const orders = challengeOrders.flatMap((order) => {
    const instrument = requiredInstrument(
      instrumentBySerial,
      order.instrumentSerial,
    );
    const user = userBySerial.get(order.userSerial);

    if (!user) {
      throw new Error(
        `Order ${order.serial} references unknown user ${order.userSerial}.`,
      );
    }

    if (order.type === 'LIMIT' && order.status === 'FILLED') {
      deviations.push({
        code: 'OMIT_LIMIT_FILLED',
        detail: `Omitted ${order.side} LIMIT FILLED of ${instrument.ticker}, size ${order.size} at ${order.price}, because that state is not allowed.`,
      });
      return [];
    }

    const cash = order.side === 'CASH_IN' || order.side === 'CASH_OUT';

    if (cash) {
      deviations.push({
        code: 'CASH_WITHOUT_PRICE',
        detail: `${order.side} of ${order.size} ${instrument.ticker} keeps the amount and drops type ${order.type} and price ${order.price}.`,
      });
    }

    let rejectionReason: SeedOrder['rejectionReason'] = null;

    if (order.status === 'REJECTED') {
      if (
        order.side !== 'SELL' ||
        instrument.ticker !== 'PAMP' ||
        order.size !== '100'
      ) {
        throw new Error(
          `Order ${order.serial} is rejected without an approved inferred reason.`,
        );
      }

      rejectionReason = 'INSUFFICIENT_SHARES';
      deviations.push({
        code: 'INFERRED_REJECTION_REASON',
        detail:
          'SELL REJECTED of 100 PAMP is stored with INSUFFICIENT_SHARES. The original row has no reason; it was inferred because only 40 PAMP were settled before that order.',
      });
    }

    return [
      {
        id: challengeFixtureId('order', order.serial),
        accountId: challengeFixtureId('account', user.serial),
        instrumentId: challengeFixtureId('instrument', instrument.serial),
        side: order.side,
        size: order.size,
        price: cash ? null : order.price,
        type: cash ? null : order.type,
        status: order.status,
        rejectionReason,
        placedAt: utcDateTime(order.datetime),
      },
    ];
  });

  return {
    users: challengeUsers.map((user) => ({
      id: challengeFixtureId('user', user.serial),
      email: user.email,
    })),
    accounts: challengeUsers.map((user) => ({
      id: challengeFixtureId('account', user.serial),
      userId: challengeFixtureId('user', user.serial),
      accountNumber: user.accountNumber,
    })),
    instruments,
    marketData,
    orders,
    deviations,
  };
}

function requiredInstrument(
  instruments: ReadonlyMap<number, { serial: number; ticker: string }>,
  serial: number,
): { serial: number; ticker: string } {
  const instrument = instruments.get(serial);

  if (!instrument) {
    throw new Error(`Unknown instrument serial ${serial}.`);
  }

  return instrument;
}

function numeric10Scale2(value: string): string {
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = body.split('.');
  const digits = `${fraction}000`;
  let minor = BigInt(whole) * 100n + BigInt(digits.slice(0, 2));

  if (digits[2] !== '0' && digits[2] !== undefined && digits[2] >= '5') {
    minor += 1n;
  }

  const scaled = `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;

  return negative ? `-${scaled}` : scaled;
}

function significantFraction(value: string): string {
  return (value.split('.')[1] ?? '').replace(/0+$/, '');
}

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function utcDateTime(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}.000Z`);
}

export function omittedMarketRow(row: ChallengeMarketRow): boolean {
  return row.open === null || row.high === null || row.low === null;
}
