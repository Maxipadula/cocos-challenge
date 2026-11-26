export class PortfolioCurrencyPositionError extends Error {
  constructor(readonly instrumentId: string) {
    super(
      `Portfolio position ${instrumentId} references a currency instrument.`,
    );
    this.name = 'PortfolioCurrencyPositionError';
  }
}
