export class AccountPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountPersistenceError';
  }
}
