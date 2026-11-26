import { describe, expect, it, vi } from 'vitest';

import { uuid } from '#shared/domain/value-objects/uuid.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';
import type { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { PrismaInstrumentQueries } from '#instruments/infrastructure/prisma/prisma-instrument-queries.js';

import { Prisma } from '../../../../src/generated/prisma/client.js';

const instrumentId = '00000000-0000-4000-8000-000000000014';

function sqlText(strings: TemplateStringsArray): string {
  return strings.join('?');
}

function createHarness() {
  const findUnique = vi.fn();
  const queryRaw = vi.fn();
  const prisma = {
    instrument: { findUnique },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  const provider = new PrismaClientProvider(prisma);
  const getClient = vi.spyOn(provider, 'getClient');
  const getTransactionClient = vi.spyOn(provider, 'getTransactionClient');

  return {
    findUnique,
    queryRaw,
    getClient,
    getTransactionClient,
    queries: new PrismaInstrumentQueries(provider),
  };
}

describe('PrismaInstrumentQueries', () => {
  it('returns an instrument by id, including currency', async () => {
    const { findUnique, getClient, getTransactionClient, queries } =
      createHarness();
    findUnique.mockResolvedValue({
      id: instrumentId,
      ticker: 'ARS',
      name: 'Peso argentino',
      type: 'MONEDA',
    });

    await expect(queries.findById(uuid(instrumentId))).resolves.toEqual({
      id: instrumentId,
      ticker: 'ARS',
      name: 'Peso argentino',
      type: 'MONEDA',
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: instrumentId },
      select: { id: true, ticker: true, name: true, type: true },
    });
    expect(getClient).toHaveBeenCalledOnce();
    expect(getTransactionClient).not.toHaveBeenCalled();
  });

  it('finds ARS by ticker without excluding currency instruments', async () => {
    const { queryRaw, findUnique, getClient, getTransactionClient, queries } =
      createHarness();
    queryRaw.mockResolvedValue([
      {
        id: instrumentId,
        ticker: 'ARS',
        name: 'Peso argentino',
        type: 'MONEDA',
      },
    ]);

    await expect(queries.findByTicker('ARS')).resolves.toEqual({
      id: instrumentId,
      ticker: 'ARS',
      name: 'Peso argentino',
      type: 'MONEDA',
    });

    const [statement, ticker] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string,
    ];
    const sql = sqlText(statement);

    expect(ticker).toBe('ARS');
    expect(sql).toContain('ticker =');
    expect(sql).not.toContain('MONEDA');
    expect(sql).not.toContain('ARS');
    expect(findUnique).not.toHaveBeenCalled();
    expect(getClient).toHaveBeenCalledOnce();
    expect(getTransactionClient).not.toHaveBeenCalled();
  });

  it('returns null when the instrument does not exist', async () => {
    const { findUnique, queries } = createHarness();
    findUnique.mockResolvedValue(null);

    await expect(queries.findById(uuid(instrumentId))).resolves.toBeNull();
  });

  it('builds a deterministic search and escapes like wildcards', async () => {
    const { queryRaw, getClient, queries } = createHarness();
    queryRaw.mockResolvedValue([]);

    await expect(queries.search('100%_\\', 10)).resolves.toEqual([]);

    const [statement, firstPattern, secondPattern, exactTerm, limit] = queryRaw
      .mock.calls[0] as [TemplateStringsArray, string, string, string, number];
    const sql = sqlText(statement);

    expect(firstPattern).toBe('%100\\%\\_\\\\%');
    expect(secondPattern).toBe('%100\\%\\_\\\\%');
    expect(exactTerm).toBe('100%_\\');
    expect(limit).toBe(10);
    expect(sql).toContain("type <> 'MONEDA'");
    expect(sql).toContain('lower(ticker) LIKE');
    expect(sql).toContain('lower(name) LIKE');
    expect(sql).toContain("ESCAPE '\\'");
    expect(sql).toContain('ORDER BY (lower(ticker) =');
    expect(sql).toContain('DESC');
    expect(sql).toContain('ticker ASC, id ASC');
    expect(sql).toContain('LIMIT');
    expect(sql).not.toContain('100%_\\');
    expect(getClient).toHaveBeenCalledOnce();
  });

  it('returns null when the instrument has no market data', async () => {
    const { queryRaw, queries } = createHarness();
    queryRaw.mockResolvedValue([]);

    await expect(
      queries.latestMarketData(uuid(instrumentId)),
    ).resolves.toBeNull();
  });

  it('selects the latest quote through the ordered query', async () => {
    const { queryRaw, queries } = createHarness();
    queryRaw.mockResolvedValue([
      {
        close: new Prisma.Decimal('10.50'),
        previous_close: new Prisma.Decimal('10.00'),
        observed_at: new Date('2026-01-16T00:00:00.000Z'),
      },
    ]);

    const quote = await queries.latestMarketData(uuid(instrumentId));
    const [statement] = queryRaw.mock.calls[0] as [TemplateStringsArray];

    expect(quote?.observedAt).toBe('2026-01-16T00:00:00.000Z');
    expect(sqlText(statement)).toContain('ORDER BY observed_at DESC');
    expect(sqlText(statement)).toContain('LIMIT 1');
  });

  it('keeps a zero previous close', async () => {
    const { queryRaw, queries } = createHarness();
    queryRaw.mockResolvedValue([
      {
        close: new Prisma.Decimal('10.50'),
        previous_close: new Prisma.Decimal(0),
        observed_at: new Date('2026-01-15T00:00:00.000Z'),
      },
    ]);

    const quote = await queries.latestMarketData(uuid(instrumentId));

    expect(quote?.previousClose).toBe('0');
    expect(quote?.observedAt).toBe('2026-01-15T00:00:00.000Z');
  });

  it('preserves small and large decimals without scientific notation', async () => {
    const { queryRaw, getTransactionClient, queries } = createHarness();
    const close = new Prisma.Decimal(`${'9'.repeat(20)}.${'1'.repeat(18)}`);
    const previousClose = new Prisma.Decimal('0.000000000000000001');
    queryRaw.mockResolvedValue([
      {
        close,
        previous_close: previousClose,
        observed_at: new Date('2026-01-15T18:30:00.000Z'),
      },
    ]);

    const quote = await queries.latestMarketData(uuid(instrumentId));

    expect(quote?.close).toBe(close.toFixed());
    expect(quote?.previousClose).toBe('0.000000000000000001');
    expect(quote?.close).not.toMatch(/e/i);
    expect(quote?.previousClose).not.toMatch(/e/i);
    expect(new Prisma.Decimal(quote?.close ?? '').equals(close)).toBe(true);
    expect(
      new Prisma.Decimal(quote?.previousClose ?? '').equals(previousClose),
    ).toBe(true);
    expect(getTransactionClient).not.toHaveBeenCalled();
  });

  it('does not query when a batch is empty', async () => {
    const { queryRaw, queries } = createHarness();

    await expect(queries.findByIds([])).resolves.toEqual([]);
    await expect(queries.latestMarketDataFor([])).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('loads instruments and their latest quotes in one query each', async () => {
    const first = uuid('00000000-0000-4000-8000-000000000014');
    const second = uuid('00000000-0000-4000-8000-000000000015');
    const { queryRaw, getTransactionClient, queries } = createHarness();
    queryRaw
      .mockResolvedValueOnce([
        { id: first, ticker: 'GGAL', name: 'Grupo Galicia', type: 'ACCIONES' },
        { id: second, ticker: 'YPF', name: 'YPF', type: 'ACCIONES' },
      ])
      .mockResolvedValueOnce([
        {
          instrument_id: first,
          close: new Prisma.Decimal('10.50'),
          previous_close: new Prisma.Decimal('10.00'),
          observed_at: new Date('2026-01-16T00:00:00.000Z'),
        },
      ]);

    await expect(queries.findByIds([first, second])).resolves.toEqual([
      { id: first, ticker: 'GGAL', name: 'Grupo Galicia', type: 'ACCIONES' },
      { id: second, ticker: 'YPF', name: 'YPF', type: 'ACCIONES' },
    ]);
    await expect(queries.latestMarketDataFor([first, second])).resolves.toEqual([
      {
        instrumentId: first,
        close: new Prisma.Decimal('10.50').toFixed(),
        previousClose: new Prisma.Decimal('10.00').toFixed(),
        observedAt: '2026-01-16T00:00:00.000Z',
      },
    ]);

    const [instrumentsSql, instrumentIds] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string[],
    ];
    const [quotesSql, quoteIds] = queryRaw.mock.calls[1] as [
      TemplateStringsArray,
      string[],
    ];

    expect(instrumentIds).toEqual([first, second]);
    expect(sqlText(instrumentsSql)).toContain('id = ANY(');
    expect(sqlText(instrumentsSql)).toContain('::uuid[]');
    expect(quoteIds).toEqual([first, second]);
    expect(sqlText(quotesSql)).toContain('unnest(');
    expect(sqlText(quotesSql)).toContain('JOIN LATERAL');
    expect(sqlText(quotesSql)).toContain('ORDER BY observed_at DESC');
    expect(sqlText(quotesSql)).toContain('LIMIT 1');
    expect(getTransactionClient).not.toHaveBeenCalled();
  });

  it('asks once per instrument when latest quotes repeat ids', async () => {
    const first = uuid('00000000-0000-4000-8000-000000000014');
    const second = uuid('00000000-0000-4000-8000-000000000015');
    const { queryRaw, queries } = createHarness();
    queryRaw.mockResolvedValue([
      {
        instrument_id: first,
        close: new Prisma.Decimal('10.50'),
        previous_close: new Prisma.Decimal('10.00'),
        observed_at: new Date('2026-01-16T00:00:00.000Z'),
      },
      {
        instrument_id: second,
        close: new Prisma.Decimal('20.00'),
        previous_close: new Prisma.Decimal('19.00'),
        observed_at: new Date('2026-01-16T00:00:00.000Z'),
      },
    ]);

    const quotes = await queries.latestMarketDataFor([
      first,
      second,
      first,
      second,
    ]);
    const [, requestedIds] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string[],
    ];

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(requestedIds).toEqual([first, second]);
    expect(quotes.map((quote) => quote.instrumentId)).toEqual([first, second]);
  });

  it('does not query latest quotes for an empty id list', async () => {
    const { queryRaw, queries } = createHarness();

    await expect(queries.latestMarketDataFor([])).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
