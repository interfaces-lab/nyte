import type { JsonValue } from "@nyte-ai/schema";

export type { JsonValue };

export type JsonObject = { [key: string]: JsonValue };

function isObject<Value>(value: Value): value is Value & object {
  return typeof value === "object" && value !== null;
}

function isStringOrBoolean<Value>(value: Value): value is Value & (string | boolean) {
  return typeof value === "string" || typeof value === "boolean";
}

function isNumber<Value>(value: Value): value is Value & number {
  return typeof value === "number";
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clone a runtime value only if live execution and durable JSON replay are equivalent. */
export function toJsonValue<Value>(value: Value): JsonValue {
  assertJsonValue(value, "$", new Set());

  return cloneJson(value);
}

/** Reject anything whose JSON text would not replay as the same value. */
function assertJsonValue<Value>(
  value: Value,
  path: string,
  seen: Set<object>,
): asserts value is Value & JsonValue {
  if (value === null || isStringOrBoolean(value)) return;

  if (isNumber(value)) {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must be a finite JSON number`);

    if (Object.is(value, -0))
      throw new TypeError(`${path} cannot be negative zero in durable JSON`);

    return;
  }

  if (!isObject(value)) {
    throw new TypeError(`${path} cannot be represented as JSON`);
  }

  if (seen.has(value)) throw new TypeError(`${path} contains a repeated or circular reference`);

  seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || !Object.isExtensible(value)) {
      throw new TypeError(`${path} must be a plain JSON array`);
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`${path} cannot contain non-index array properties`);
    }

    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "length") continue;
      const index = Number(key);

      if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
        throw new TypeError(`${path} cannot contain non-index array properties`);
      }
    }

    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));

      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !descriptor.configurable ||
        !("value" in descriptor) ||
        !descriptor.writable
      ) {
        throw new TypeError(`${path}[${index}] must be a mutable enumerable data property`);
      }

      assertJsonValue(descriptor.value, `${path}[${index}]`, seen);
    }

    return;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype || !Object.isExtensible(value)) {
    throw new TypeError(`${path} must be a plain JSON object`);
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${path} cannot contain symbol keys`);
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !descriptor.configurable ||
      !("value" in descriptor) ||
      !descriptor.writable
    ) {
      throw new TypeError(`${path}.${key} must be a mutable enumerable data property`);
    }

    // Match JSON.stringify: an undefined property is absent, not an error. Tool
    // prepareArguments routinely return `{ path, offset, limit }` with omitted optionals.
    if (descriptor.value === undefined) continue;
    assertJsonValue(descriptor.value, `${path}.${key}`, seen);
  }
}

/** A fresh plain copy of an already-checked value, with undefined properties left out. */
function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);

  if (!isJsonObject(value)) return value;
  const entries: Array<[string, JsonValue]> = [];

  for (const [key, member] of Object.entries(value)) {
    if (member !== undefined) entries.push([key, cloneJson(member)]);
  }

  return Object.fromEntries(entries);
}
