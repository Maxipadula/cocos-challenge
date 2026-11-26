import { describe, expect, it } from 'vitest';

import { uuid } from '#shared/domain/value-objects/uuid.js';
import { NodeUuidGenerator } from '#shared/infrastructure/uuid/node-uuid-generator.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('NodeUuidGenerator', () => {
  it('generates a UUID v4 that the domain accepts', () => {
    const generated = new NodeUuidGenerator().generate();

    expect(generated).toMatch(UUID_V4);
    expect(uuid(generated)).toBe(generated);
  });

  it('returns a new identifier on every call', () => {
    const generator = new NodeUuidGenerator();
    const first = generator.generate();
    const second = generator.generate();

    expect(first).not.toBe(second);
    expect(uuid(first)).toBe(first);
    expect(uuid(second)).toBe(second);
  });
});
