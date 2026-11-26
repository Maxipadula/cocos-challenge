export class InvalidPortfolioQuantityError extends Error {
  constructor() {
    super('Portfolio quantity must be a signed integer.');
    this.name = 'InvalidPortfolioQuantityError';
  }
}
