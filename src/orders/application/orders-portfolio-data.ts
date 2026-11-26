import type { Uuid } from '#shared/domain/value-objects/uuid.js';

export type PortfolioPositionQuantity = {
  readonly instrumentId: Uuid;
  readonly quantity: string;
  readonly reservedQuantity: string;
  readonly availableQuantity: string;
};

export type AccountPortfolioSnapshot = {
  readonly accountId: Uuid;
  readonly settledCash: string;
  readonly reservedCash: string;
  readonly availableCash: string;
  readonly positions: readonly PortfolioPositionQuantity[];
};

export abstract class OrdersPortfolioDataProvider {
  abstract findByUserId(
    userId: Uuid,
  ): Promise<AccountPortfolioSnapshot | null>;
}
