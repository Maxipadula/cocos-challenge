export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | JsonObject;

export type JsonObject = { readonly [key: string]: JsonValue };

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
