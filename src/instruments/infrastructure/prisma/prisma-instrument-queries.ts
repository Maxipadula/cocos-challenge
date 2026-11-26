import { Injectable } from '@nestjs/common';

import { type Uuid, uuid } from '#shared/domain/value-objects/uuid.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';

import { Prisma } from '../../../generated/prisma/client.js';
import {
  type InstrumentInfo,
  InstrumentQueries,
  type MarketDataQuote,
} from '../../application/instrument-queries.js';

type InstrumentRow = {
  id: string;
  ticker: string;
  name: string;
  type: string;
};

type MarketDataRow = {
  close: Prisma.Decimal;
  previous_close: Prisma.Decimal;
  observed_at: Date;
};

type BatchMarketDataRow = MarketDataRow & {
  instrument_id: string;
};

@Injectable()
export class PrismaInstrumentQueries extends InstrumentQueries {
  constructor(private readonly clients: PrismaClientProvider) {
    super();
  }

  override async findById(id: Uuid): Promise<InstrumentInfo | null> {
    const row = await this.clients.getClient().instrument.findUnique({
      where: { id },
      select: { id: true, ticker: true, name: true, type: true },
    });

    if (!row) {
      return null;
    }

    return toInstrumentInfo(row);
  }

  override async search(
    term: string,
    limit = 20,
  ): Promise<readonly InstrumentInfo[]> {
    const pattern = `%${escapeLike(term)}%`;
    const rows = await this.clients.getClient().$queryRaw<InstrumentRow[]>`
      SELECT id, ticker, name, type
      FROM instruments
      WHERE type <> 'MONEDA'
        AND (
          lower(ticker) LIKE ${pattern} ESCAPE '\\'
          OR lower(name) LIKE ${pattern} ESCAPE '\\'
        )
      ORDER BY (lower(ticker) = ${term}) DESC, ticker ASC, id ASC
      LIMIT ${limit}
    `;

    return rows.map(toInstrumentInfo);
  }

  override async latestMarketData(id: Uuid): Promise<MarketDataQuote | null> {
    const rows = await this.clients.getClient().$queryRaw<MarketDataRow[]>`
      SELECT close, previous_close, observed_at
      FROM market_data
      WHERE instrument_id = ${id}::uuid
      ORDER BY observed_at DESC
      LIMIT 1
    `;
    const row = rows[0];

    if (!row) {
      return null;
    }

    return toMarketDataQuote(id, row);
  }

  override async findByIds(
    ids: readonly Uuid[],
  ): Promise<readonly InstrumentInfo[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.clients.getClient().$queryRaw<InstrumentRow[]>`
      SELECT id, ticker, name, type
      FROM instruments
      WHERE id = ANY(${[...ids]}::uuid[])
    `;

    return rows.map(toInstrumentInfo);
  }

  override async latestMarketDataFor(
    ids: readonly Uuid[],
  ): Promise<readonly MarketDataQuote[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.clients.getClient().$queryRaw<BatchMarketDataRow[]>`
      SELECT
        md.instrument_id,
        md.close,
        md.previous_close,
        md.observed_at
      FROM unnest(${[...ids]}::uuid[]) AS requested(id)
      JOIN LATERAL (
        SELECT instrument_id, close, previous_close, observed_at
        FROM market_data
        WHERE instrument_id = requested.id
        ORDER BY observed_at DESC
        LIMIT 1
      ) md ON true
    `;

    return rows.map((row) => toMarketDataQuote(row.instrument_id, row));
  }
}

function toMarketDataQuote(
  instrumentId: string,
  row: MarketDataRow,
): MarketDataQuote {
  return {
    instrumentId: uuid(instrumentId),
    close: decimalToPlainString(row.close),
    previousClose: decimalToPlainString(row.previous_close),
    observedAt: row.observed_at.toISOString(),
  };
}

function toInstrumentInfo(row: InstrumentRow): InstrumentInfo {
  return {
    id: uuid(row.id),
    ticker: row.ticker,
    name: row.name,
    type: row.type,
  };
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function decimalToPlainString(value: Prisma.Decimal): string {
  const text = value.toFixed();

  if (text.includes('e') || text.includes('E')) {
    throw new Error(
      'Decimal value cannot be represented without scientific notation.',
    );
  }

  return text;
}
