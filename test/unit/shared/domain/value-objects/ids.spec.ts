import { describe, expect, it } from 'vitest';
import { InvalidIdError } from '../../../../../src/shared/domain/errors/value-object-errors.js';
import {
  instrumentId,
  userId,
} from '../../../../../src/shared/domain/value-objects/ids.js';

const user = '6f1e7b1a-6c3d-4a7e-8f21-9b0c1d2e3f40';
const instrument = 'A1B2C3D4-E5F6-4789-8ABC-DEF012345678';

describe('identifiers', () => {
  it('accepts a UUID and stores it in lowercase', () => {
    expect(userId(user)).toBe(user);
    expect(instrumentId(instrument)).toBe(instrument.toLowerCase());
  });

  it('rejects values that are not UUIDs', () => {
    expect(() => userId('7')).toThrow(InvalidIdError);
    expect(() => userId('6f1e7b1a6c3d4a7e8f219b0c1d2e3f40')).toThrow(
      InvalidIdError,
    );
    expect(() => instrumentId('not-a-uuid')).toThrow(InvalidIdError);
  });
});
