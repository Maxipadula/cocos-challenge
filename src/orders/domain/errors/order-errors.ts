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

export class InvalidOrderIdError extends Error {
  constructor(message = 'Order id must be a positive safe integer.') {
    super(message);
    this.name = 'InvalidOrderIdError';
  }
}
