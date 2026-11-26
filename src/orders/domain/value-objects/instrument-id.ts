import { uuid, type Uuid } from '#shared/domain/value-objects/uuid.js';

declare const instrumentIdBrand: unique symbol;

export type InstrumentId = Uuid & { readonly [instrumentIdBrand]: never };

export function instrumentId(value: string): InstrumentId {
  return uuid(value) as InstrumentId;
}
