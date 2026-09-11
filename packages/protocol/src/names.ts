import { Type } from "typebox";
import { Value } from "typebox/value";

/** One git-ref component, preserving Unicode and all non-forbidden punctuation. */
// Match every code unit, including Unicode line separators, and require the absolute end.
export const HEAD_NAME_PATTERN = String.raw`^(?!\.)(?!@(?![\s\S]))(?![\s\S]*(?:\.\.|@\{))(?![\s\S]*(?:\.|\.lock)(?![\s\S]))[^\x00-\x20\x7f~^:?*\[\\/]+(?![\s\S])`;

export const HeadName = Type.String({ pattern: HEAD_NAME_PATTERN });

export function isHeadName(value: unknown): boolean {
  return Value.Check(HeadName, value);
}

export function validateHeadName(value: string): void {
  if (!isHeadName(value)) throw new TypeError(`Invalid head name: ${value}`);
}
