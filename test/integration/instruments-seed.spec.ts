import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { uuid } from '#shared/domain/value-objects/uuid.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { PrismaInstrumentQueries } from '#instruments/infrastructure/prisma/prisma-instrument-queries.js';

const databaseUrl = process.env.DATABASE_URL;
const localDatabase = databaseUrl ? isLocalDatabase(databaseUrl) : false;
const describeWithLocalDatabase =
  databaseUrl && localDatabase ? describe : describe.skip;

describeWithLocalDatabase('seeded challenge instruments', () => {
  let prisma: PrismaService;
  let queries: PrismaInstrumentQueries;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    queries = new PrismaInstrumentQueries(new PrismaClientProvider(prisma));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('reads ARS by ticker and keeps it out of search', async () => {
    const ars = await prisma.instrument.findUniqueOrThrow({
      where: { ticker: 'ARS' },
    });
    const info = await queries.findById(uuid(ars.id));
    const matches = await queries.search('ggal');

    expect(info).toMatchObject({ ticker: 'ARS', type: 'MONEDA' });
    expect(matches.map((instrument) => instrument.ticker)).toContain('GGAL');
    expect(matches.some((instrument) => instrument.ticker === 'ARS')).toBe(false);
  });

  it('uses the July 14 quote and reports instruments without market data', async () => {
    const pamp = await instrumentId('PAMP');
    const pgr = await instrumentId('PGR');
    const dome = await instrumentId('DOME');
    const latest = await queries.latestMarketData(pamp);
    const missing = await queries.latestMarketData(pgr);
    const domeQuote = await queries.latestMarketData(dome);
    const bbar = await prisma.marketData.findFirstOrThrow({
      where: {
        instrument: { ticker: 'BBAR' },
        observedAt: new Date('2023-07-14T00:00:00.000Z'),
      },
    });
    const omitted = await prisma.marketData.count({
      where: {
        instrument: { ticker: { in: ['DOME', 'POLL'] } },
        observedAt: new Date('2023-07-13T00:00:00.000Z'),
      },
    });

    expect(latest?.close).toBe('925.85');
    expect(latest?.observedAt).toBe('2023-07-14T00:00:00.000Z');
    expect(missing).toBeNull();
    expect(domeQuote?.observedAt).toBe('2023-07-14T00:00:00.000Z');
    expect(bbar.previousClose.equals('1047.17')).toBe(true);
    expect(omitted).toBe(0);
  });

  async function instrumentId(ticker: string) {
    const instrument = await prisma.instrument.findUniqueOrThrow({
      where: { ticker },
    });

    return uuid(instrument.id);
  }
});

function isLocalDatabase(connectionString: string): boolean {
  const host = new URL(connectionString).hostname;

  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
