import { describe, expect, it } from 'vitest';
import { InvalidIdError } from '../../../../../src/shared/domain/errors/value-object-errors.js';
import {
  instrumentId,
  userId,
} from '../../../../../src/shared/domain/value-objects/ids.js';

describe('identifiers', () => {
  it('accepts a positive safe integer', () => {
    expect(userId(1)).toBe(1);
    expect(instrumentId(8)).toBe(8);
  });

  it('rejects zero, fractions, and negative ids', () => {
    expect(() => userId(0)).toThrow(InvalidIdError);
    expect(() => userId(1.5)).toThrow(InvalidIdError);
    expect(() => instrumentId(-3)).toThrow(InvalidIdError);
  });
});
