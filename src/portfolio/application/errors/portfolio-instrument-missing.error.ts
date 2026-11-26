export class PortfolioInstrumentMissingError extends Error {
  constructor(readonly instrumentIds: readonly string[]) {
    super(`Portfolio instruments were not found: ${instrumentIds.join(', ')}.`);
    this.name = 'PortfolioInstrumentMissingError';
  }
}
