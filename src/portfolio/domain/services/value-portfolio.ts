import { InvalidMoneyError } from '#shared/domain/errors/value-object-errors.js';
import { Money } from '#shared/domain/value-objects/money.js';

import { InvalidPortfolioQuantityError } from '../errors/invalid-portfolio-quantity.error.js';

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;
const QUANTITY_PATTERN = /^(-?)(\d+)$/;
const PERCENT_SCALE = 4;
const PERCENT_FACTOR = 100n * 10n ** BigInt(PERCENT_SCALE);

export type PortfolioQuote = {
  readonly close: string;
  readonly previousClose: string;
};

export type PortfolioPositionInput = {
  readonly instrumentId: string;
  readonly ticker: string;
  readonly name: string;
  readonly quantity: string;
  readonly reservedQuantity: string;
  readonly availableQuantity: string;
  readonly quote: PortfolioQuote | null;
};

export type PortfolioPosition = {
  readonly instrumentId: string;
  readonly ticker: string;
  readonly name: string;
  readonly quantity: string;
  readonly reservedQuantity: string;
  readonly availableQuantity: string;
  readonly close: string | null;
  readonly marketValue: string | null;
  readonly dailyReturnPercentage: string | null;
};

export type PortfolioValuation = {
  readonly settledCash: string;
  readonly reservedCash: string;
  readonly availableCash: string;
  readonly totalValue: string | null;
  readonly positions: readonly PortfolioPosition[];
};

export function valuePortfolio(input: {
  readonly settledCash: string;
  readonly reservedCash: string;
  readonly availableCash: string;
  readonly positions: readonly PortfolioPositionInput[];
}): PortfolioValuation {
  const settled = Money.fromCalculation(input.settledCash);
  const reserved = Money.fromCalculation(input.reservedCash);
  const available = Money.fromCalculation(input.availableCash);
  let total: Money | null = settled;
  const positions = input.positions.map((position) => {
    const quantity = parseSignedInteger(position.quantity);
    const reservedQuantity = canonicalQuantity(position.reservedQuantity);
    const availableQuantity = canonicalQuantity(position.availableQuantity);

    if (!position.quote) {
      total = null;

      return unvalued(position, reservedQuantity, availableQuantity);
    }

    const close = Money.parse(position.quote.close);
    const marketValue = close.multiplyInteger(quantity);

    if (total) {
      total = total.add(marketValue);
    }

    return {
      instrumentId: position.instrumentId,
      ticker: position.ticker,
      name: position.name,
      quantity: quantity.toString(),
      reservedQuantity,
      availableQuantity,
      close: close.toDecimalString(),
      marketValue: marketValue.toDecimalString(),
      dailyReturnPercentage: dailyReturnPercentage(
        position.quote.close,
        position.quote.previousClose,
      ),
    };
  });

  return {
    settledCash: settled.toDecimalString(),
    reservedCash: reserved.toDecimalString(),
    availableCash: available.toDecimalString(),
    totalValue: total?.toDecimalString() ?? null,
    positions,
  };
}

export function dailyReturnPercentage(
  close: string,
  previousClose: string,
): string | null {
  const current = readDecimal(close);
  const previous = readDecimal(previousClose);

  if (previous.units === 0n) {
    return null;
  }

  const scale = current.scale > previous.scale ? current.scale : previous.scale;
  const currentUnits = rescale(current, scale);
  const previousUnits = rescale(previous, scale);
  const delta = currentUnits - previousUnits;
  const negative = delta < 0n !== previousUnits < 0n;
  const numerator = abs(delta) * PERCENT_FACTOR;
  const denominator = abs(previousUnits);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;

  return formatScaled(negative ? -rounded : rounded, PERCENT_SCALE);
}

function unvalued(
  position: PortfolioPositionInput,
  reservedQuantity: string,
  availableQuantity: string,
): PortfolioPosition {
  return {
    instrumentId: position.instrumentId,
    ticker: position.ticker,
    name: position.name,
    quantity: parseSignedInteger(position.quantity).toString(),
    reservedQuantity,
    availableQuantity,
    close: null,
    marketValue: null,
    dailyReturnPercentage: null,
  };
}

function canonicalQuantity(value: string): string {
  return parseSignedInteger(value).toString();
}

function parseSignedInteger(value: string): bigint {
  const match = QUANTITY_PATTERN.exec(value);

  if (!match) {
    throw new InvalidPortfolioQuantityError();
  }

  const sign = match[1] === '-' ? -1n : 1n;

  return sign * BigInt(match[2]);
}

function readDecimal(value: string): { units: bigint; scale: number } {
  const match = DECIMAL_PATTERN.exec(value.trim());
  const fraction = match?.[3] ?? '';

  if (!match || fraction.length > 18) {
    throw new InvalidMoneyError();
  }

  const sign = match[1] === '-' ? -1n : 1n;

  return {
    units: sign * BigInt(match[2] + fraction),
    scale: fraction.length,
  };
}

function rescale(
  value: { units: bigint; scale: number },
  scale: number,
): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, '0');
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale);
  const body = `${whole}.${fraction}`;

  return negative ? `-${body}` : body;
}
