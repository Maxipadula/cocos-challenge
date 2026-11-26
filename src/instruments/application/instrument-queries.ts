import type { InstrumentId } from '../../shared/domain/value-objects/ids.js';
import type { UnitPrice } from '../../shared/domain/value-objects/unit-price.js';

export type InstrumentInfo = {
  readonly id: InstrumentId;
  readonly type: string;
};

export abstract class InstrumentQueries {
  abstract findById(id: InstrumentId): Promise<InstrumentInfo | null>;

  abstract latestClose(id: InstrumentId): Promise<UnitPrice | null>;
}
