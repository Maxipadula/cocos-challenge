import type { Uuid } from '#shared/domain/value-objects/uuid.js';

export type InstrumentInfo = {
  readonly id: Uuid;
  readonly type: string;
};

export abstract class InstrumentQueries {
  abstract findById(id: Uuid): Promise<InstrumentInfo | null>;

  abstract latestClose(id: Uuid): Promise<string | null>;
}
