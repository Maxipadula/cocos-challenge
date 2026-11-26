export class InvalidMoneyError extends Error {
  constructor(message = 'Invalid money amount.') {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class InvalidUnitPriceError extends Error {
  constructor(message = 'Unit price must be positive.') {
    super(message);
    this.name = 'InvalidUnitPriceError';
  }
}

export class InvalidShareQuantityError extends Error {
  constructor(message = 'Share quantity must be a non-negative integer.') {
    super(message);
    this.name = 'InvalidShareQuantityError';
  }
}

export class InvalidIdError extends Error {
  constructor(message = 'Identifier must be a positive safe integer.') {
    super(message);
    this.name = 'InvalidIdError';
  }
}
