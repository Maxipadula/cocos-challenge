import { describe, expect, it } from 'vitest';
import { orderId } from '../../../../src/orders/domain/value-objects/order-id.js';
import { NodeUuidGenerator } from '../../../../src/shared/infrastructure/uuid/node-uuid-generator.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('NodeUuidGenerator', () => {
  it('generates a UUID v4 that the domain accepts as an order id', () => {
    const generated = new NodeUuidGenerator().generate();

    expect(generated).toMatch(UUID_V4);
    expect(orderId(generated)).toBe(generated);
  });
});
