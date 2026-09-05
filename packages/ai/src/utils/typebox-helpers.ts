/**
 * TypeBox helpers for tool parameter schemas.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/typebox-helpers.ts
 * Synced with pi 7ebf9087e.
 */
import { Type } from "typebox";

/**
 * Creates a string enum schema compatible with Google's API and other providers
 * that don't support anyOf/const patterns.
 *
 * @example
 * const OperationSchema = StringEnum(["add", "subtract", "multiply", "divide"], {
 *   description: "The operation to perform"
 * });
 *
 * type Operation = Static<typeof OperationSchema>; // "add" | "subtract" | "multiply" | "divide"
 */
export function StringEnum<T extends string[]>(
  values: readonly [...T],
  options?: { description?: string; default?: T[number] },
) {
  return Type.Enum(values, { type: "string", ...options });
}
