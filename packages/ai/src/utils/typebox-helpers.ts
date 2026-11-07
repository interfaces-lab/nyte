import { Type } from "typebox";

export function StringEnum<T extends string[]>(
  values: readonly [...T],
  options?: { description?: string; default?: T[number] },
) {
  return Type.Enum(values, { type: "string", ...options });
}
