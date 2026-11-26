export class InvalidSearchLimitError extends Error {
  constructor() {
    super('Search limit must be an integer between 1 and 50.');
    this.name = 'InvalidSearchLimitError';
  }
}
