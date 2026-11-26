export class PortfolioAccountNotFoundError extends Error {
  constructor() {
    super('Portfolio account was not found.');
    this.name = 'PortfolioAccountNotFoundError';
  }
}
