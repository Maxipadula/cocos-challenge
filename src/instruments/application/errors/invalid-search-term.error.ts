export class EmptySearchTermError extends Error {
  constructor() {
    super('Search term must not be empty.');
    this.name = 'EmptySearchTermError';
  }
}

export class SearchTermTooLongError extends Error {
  constructor() {
    super('Search term must not exceed 64 characters.');
    this.name = 'SearchTermTooLongError';
  }
}
