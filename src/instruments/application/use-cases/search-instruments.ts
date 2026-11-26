import { InvalidSearchLimitError } from '../errors/invalid-search-limit.error.js';
import {
  EmptySearchTermError,
  SearchTermTooLongError,
} from '../errors/invalid-search-term.error.js';
import type {
  InstrumentInfo,
  InstrumentQueries,
} from '../instrument-queries.js';

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
const MAX_SEARCH_TERM_LENGTH = 64;

export class SearchInstruments {
  constructor(private readonly instruments: InstrumentQueries) {}

  async execute(
    term: string,
    limit = DEFAULT_SEARCH_LIMIT,
  ): Promise<readonly InstrumentInfo[]> {
    const normalized = normalizeSearchTerm(term);
    assertSearchLimit(limit);

    return this.instruments.search(normalized, limit);
  }
}

function normalizeSearchTerm(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new EmptySearchTermError();
  }

  if (trimmed.length > MAX_SEARCH_TERM_LENGTH) {
    throw new SearchTermTooLongError();
  }

  return trimmed.toLowerCase();
}

function assertSearchLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new InvalidSearchLimitError();
  }
}
