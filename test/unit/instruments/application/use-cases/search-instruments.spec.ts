import { describe, expect, it } from 'vitest';

import { InvalidSearchLimitError } from '#instruments/application/errors/invalid-search-limit.error.js';
import {
  EmptySearchTermError,
  SearchTermTooLongError,
} from '#instruments/application/errors/invalid-search-term.error.js';
import {
  type InstrumentInfo,
  InstrumentQueries,
  type MarketDataQuote,
} from '#instruments/application/instrument-queries.js';
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  SearchInstruments,
} from '#instruments/application/use-cases/search-instruments.js';

class FakeInstrumentQueries extends InstrumentQueries {
  readonly searches: Array<{ term: string; limit: number | undefined }> = [];

  override async findById(): Promise<InstrumentInfo | null> {
    return null;
  }

  override async search(
    term: string,
    limit?: number,
  ): Promise<readonly InstrumentInfo[]> {
    this.searches.push({ term, limit });
    return [];
  }

  override async latestMarketData(): Promise<MarketDataQuote | null> {
    return null;
  }

  override async findByIds(): Promise<readonly InstrumentInfo[]> {
    return [];
  }

  override async latestMarketDataFor(): Promise<readonly MarketDataQuote[]> {
    return [];
  }
}

describe('SearchInstruments', () => {
  it('trims and lowercases the term', async () => {
    const instruments = new FakeInstrumentQueries();
    const useCase = new SearchInstruments(instruments);

    await useCase.execute('  GGAL  ');

    expect(instruments.searches).toEqual([
      { term: 'ggal', limit: DEFAULT_SEARCH_LIMIT },
    ]);
  });

  it('rejects an empty term before querying', async () => {
    const instruments = new FakeInstrumentQueries();
    const useCase = new SearchInstruments(instruments);

    await expect(useCase.execute('')).rejects.toBeInstanceOf(
      EmptySearchTermError,
    );
    expect(instruments.searches).toEqual([]);
  });

  it('rejects a term that is only spaces before querying', async () => {
    const instruments = new FakeInstrumentQueries();
    const useCase = new SearchInstruments(instruments);

    await expect(useCase.execute('   ')).rejects.toBeInstanceOf(
      EmptySearchTermError,
    );
    expect(instruments.searches).toEqual([]);
  });

  it('rejects a term longer than 64 characters before querying', async () => {
    const instruments = new FakeInstrumentQueries();
    const useCase = new SearchInstruments(instruments);

    await expect(useCase.execute('a'.repeat(65))).rejects.toBeInstanceOf(
      SearchTermTooLongError,
    );
    await useCase.execute('a'.repeat(64));

    expect(instruments.searches).toEqual([
      { term: 'a'.repeat(64), limit: DEFAULT_SEARCH_LIMIT },
    ]);
  });

  it('searches with the default limit of 20', async () => {
    const instruments = new FakeInstrumentQueries();
    const useCase = new SearchInstruments(instruments);

    await useCase.execute('ggal');

    expect(instruments.searches).toEqual([
      { term: 'ggal', limit: DEFAULT_SEARCH_LIMIT },
    ]);
    expect(DEFAULT_SEARCH_LIMIT).toBe(20);
  });

  it('accepts limits from 1 to 50', async () => {
    const instruments = new FakeInstrumentQueries();
    const useCase = new SearchInstruments(instruments);

    await useCase.execute('ggal', 1);
    await useCase.execute('ggal', MAX_SEARCH_LIMIT);

    expect(instruments.searches.map((search) => search.limit)).toEqual([1, 50]);
  });

  it('rejects an invalid limit before querying', async () => {
    const instruments = new FakeInstrumentQueries();
    const useCase = new SearchInstruments(instruments);

    await expect(useCase.execute('ggal', 0)).rejects.toBeInstanceOf(
      InvalidSearchLimitError,
    );
    await expect(useCase.execute('ggal', -1)).rejects.toBeInstanceOf(
      InvalidSearchLimitError,
    );
    await expect(useCase.execute('ggal', 1.5)).rejects.toBeInstanceOf(
      InvalidSearchLimitError,
    );
    await expect(useCase.execute('ggal', 51)).rejects.toBeInstanceOf(
      InvalidSearchLimitError,
    );
    expect(instruments.searches).toEqual([]);
  });
});
