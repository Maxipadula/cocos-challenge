import { Injectable } from '@nestjs/common';

import {
  InvalidIdError,
  InvalidMoneyError,
} from '#shared/domain/errors/value-object-errors.js';
import { Money } from '#shared/domain/value-objects/money.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';

import { type Prisma } from '../../../generated/prisma/client.js';
import { AccountRepository } from '../../application/ports/account-repository.js';
import { Account } from '../../domain/entities/account.js';
import { ReservationNotPersistableError } from '../../domain/errors/order-errors.js';
import type { AccountId } from '../../domain/value-objects/account-id.js';
import {
  instrumentId,
  type InstrumentId,
} from '../../domain/value-objects/instrument-id.js';
import { AccountPersistenceError } from './account-persistence.error.js';

type AccountReservationRow = {
  reserved_cash: Prisma.Decimal;
  reserved_positions: unknown;
};

type StoredPosition = {
  instrument_id: string;
  quantity: Prisma.Decimal;
};

@Injectable()
export class PrismaAccountRepository extends AccountRepository {
  constructor(private readonly clients: PrismaClientProvider) {
    super();
  }

  override async findById(accountId: AccountId): Promise<Account | null> {
    const rows = await this.clients.getTransactionClient().$queryRaw<
      AccountReservationRow[]
    >`
      SELECT
        accounts.reserved_cash,
        (
          SELECT COALESCE(json_agg(json_build_object(
            'instrument_id', positions.instrument_id,
            'quantity', positions.quantity::text
          ) ORDER BY positions.instrument_id), '[]'::json)
          FROM account_reserved_positions AS positions
          WHERE positions.account_id = accounts.id
        ) AS reserved_positions
      FROM accounts
      WHERE accounts.id = ${accountId}::uuid
    `;
    const row = rows[0];

    if (!row) {
      return null;
    }

    return reconstituteAccount(accountId, row);
  }

  override async save(account: Account): Promise<void> {
    const client = this.clients.getTransactionClient();
    const reservedCash = account.reservedCash.toDecimalString();
    const updated = await client.$executeRaw`
      UPDATE accounts
      SET reserved_cash = ${reservedCash}::numeric
      WHERE id = ${account.id}::uuid
    `;

    if (updated !== 1) {
      throw new AccountPersistenceError(
        'Account update did not change any row.',
      );
    }

    const current = await client.$queryRaw<StoredPosition[]>`
      SELECT instrument_id, quantity
      FROM account_reserved_positions
      WHERE account_id = ${account.id}::uuid
      FOR UPDATE
    `;
    const desired = new Map(
      account
        .reservedSharePositions()
        .map((position) => [position.instrumentId, position.quantity]),
    );
    const stored = new Set<InstrumentId>();

    for (const position of current) {
      const storedInstrumentId = readInstrumentId(position.instrument_id);
      stored.add(storedInstrumentId);
      const quantity = desired.get(storedInstrumentId);

      if (quantity === undefined) {
        await client.$executeRaw`
          DELETE FROM account_reserved_positions
          WHERE account_id = ${account.id}::uuid
            AND instrument_id = ${storedInstrumentId}::uuid
        `;
        continue;
      }

      if (quantityFromDecimal(position.quantity) !== quantity) {
        await client.$executeRaw`
          UPDATE account_reserved_positions
          SET quantity = ${quantity.toString()}::numeric
          WHERE account_id = ${account.id}::uuid
            AND instrument_id = ${storedInstrumentId}::uuid
        `;
      }
    }

    for (const [storedInstrumentId, quantity] of desired) {
      if (stored.has(storedInstrumentId)) {
        continue;
      }

      await client.$executeRaw`
        INSERT INTO account_reserved_positions (
          account_id,
          instrument_id,
          quantity
        )
        VALUES (
          ${account.id}::uuid,
          ${storedInstrumentId}::uuid,
          ${quantity.toString()}::numeric
        )
      `;
    }
  }
}

function reconstituteAccount(
  accountId: AccountId,
  row: AccountReservationRow,
): Account {
  try {
    return Account.reconstitute({
      id: accountId,
      reservedCash: Money.parse(decimalToPlainString(row.reserved_cash)),
      reservedShares: readPositions(row.reserved_positions).map((position) => ({
        instrumentId: readInstrumentId(position.instrument_id),
        quantity: quantityFromText(position.quantity),
      })),
    });
  } catch (error) {
    if (
      error instanceof ReservationNotPersistableError ||
      error instanceof InvalidIdError ||
      error instanceof InvalidMoneyError
    ) {
      throw new AccountPersistenceError(error.message);
    }

    throw error;
  }
}

function readPositions(
  value: unknown,
): readonly { instrument_id: string; quantity: string }[] {
  const parsed = typeof value === 'string' ? parseJson(value) : value;

  if (!Array.isArray(parsed)) {
    throw new AccountPersistenceError('Reserved positions payload is invalid.');
  }

  return parsed.map((position) => {
    if (
      typeof position !== 'object' ||
      position === null ||
      !('instrument_id' in position) ||
      !('quantity' in position) ||
      typeof position.instrument_id !== 'string' ||
      typeof position.quantity !== 'string'
    ) {
      throw new AccountPersistenceError('Reserved position row is invalid.');
    }

    return {
      instrument_id: position.instrument_id,
      quantity: position.quantity,
    };
  });
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new AccountPersistenceError('Reserved positions payload is invalid.');
  }
}

function readInstrumentId(value: string): InstrumentId {
  try {
    return instrumentId(value);
  } catch (error) {
    if (error instanceof InvalidIdError) {
      throw new AccountPersistenceError(error.message);
    }

    throw error;
  }
}

function decimalToPlainString(value: Prisma.Decimal): string {
  const text = value.toFixed();

  if (text.includes('e') || text.includes('E')) {
    throw new AccountPersistenceError(
      'Decimal value cannot be represented without scientific notation.',
    );
  }

  return text;
}

function quantityFromDecimal(value: Prisma.Decimal): bigint {
  return quantityFromText(decimalToPlainString(value));
}

function quantityFromText(value: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);

  if (!match?.[1] || (match[2] !== undefined && !/^0*$/.test(match[2]))) {
    throw new AccountPersistenceError(
      'Reserved share quantity must be a whole number.',
    );
  }

  return BigInt(match[1].replace(/^0+(?=\d)/, '') || '0');
}
