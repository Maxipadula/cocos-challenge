export class AccountNotFoundError extends Error {
  constructor() {
    super('Investment account was not found.');
    this.name = 'AccountNotFoundError';
  }
}
