import { createHash } from 'node:crypto';
import type { Money } from '../domain/value-objects/money.js';
import { isJsonObject, type JsonObject, type JsonValue } from './json.js';

export function canonicalDecimal(value: Money): string {
  const text = value.toDecimalString();

  if (!text.includes('.')) {
    return text;
  }

  return text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function hashIdempotencyRequest(
  operation: string,
  payload: JsonObject,
): string {
  const canonical = canonicalize({ ...payload, operation });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (isJsonObject(value)) {
    const sorted: Record<string, JsonValue> = {};

    for (const key of Object.keys(value).sort()) {
      const nested = value[key];

      if (nested !== undefined) {
        sorted[key] = canonicalize(nested);
      }
    }

    return sorted;
  }

  return value;
}
