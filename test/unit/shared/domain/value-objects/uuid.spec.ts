import { describe, expect, it } from 'vitest';

import { InvalidIdError } from '#shared/domain/errors/value-object-errors.js';
import { uuid } from '#shared/domain/value-objects/uuid.js';

const value = '6f1e7b1a-6c3d-4a7e-8f21-9b0c1d2e3f40';

describe('uuid', () => {
  it('accepts a UUID and stores it in lowercase', () => {
    expect(uuid(value)).toBe(value);
    expect(uuid(value.toUpperCase())).toBe(value);
  });

  it('rejects values that are not UUIDs', () => {
    expect(() => uuid('7')).toThrow(InvalidIdError);
    expect(() => uuid('6f1e7b1a6c3d4a7e8f219b0c1d2e3f40')).toThrow(
      InvalidIdError,
    );
    expect(() => uuid('not-a-uuid')).toThrow(InvalidIdError);
  });
});
