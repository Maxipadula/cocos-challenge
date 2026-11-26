export class InvalidMoneyError extends Error {
  constructor(message = 'Invalid money amount.') {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class InvalidIdError extends Error {
  constructor(message = 'Identifier must be a UUID.') {
    super(message);
    this.name = 'InvalidIdError';
  }
}
