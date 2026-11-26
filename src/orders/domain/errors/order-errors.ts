export class OrderSizeRequiredError extends Error {
  constructor(
    message = 'Order size must be a positive whole number of shares.',
  ) {
    super(message);
    this.name = 'OrderSizeRequiredError';
  }
}

export class OrderNotCancellableError extends Error {
  constructor(message = 'Only a new limit order can be cancelled.') {
    super(message);
    this.name = 'OrderNotCancellableError';
  }
}

export class NonPositiveAmountError extends Error {
  constructor(message = 'Operation amount must be positive.') {
    super(message);
    this.name = 'NonPositiveAmountError';
  }
}

export class InvalidRejectionReasonError extends Error {
  constructor(message = 'Unknown rejection reason.') {
    super(message);
    this.name = 'InvalidRejectionReasonError';
  }
}

export class InvalidOrderTimestampError extends Error {
  constructor(message = 'Order timestamp is invalid.') {
    super(message);
    this.name = 'InvalidOrderTimestampError';
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

export class InvalidCashMovementError extends Error {
  constructor(message = 'Cash movement state is invalid.') {
    super(message);
    this.name = 'InvalidCashMovementError';
  }
}

export class InvalidOrderIdError extends Error {
  constructor(message = 'Order id must be a UUID.') {
    super(message);
    this.name = 'InvalidOrderIdError';
  }
}
