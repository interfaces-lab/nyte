import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const LabSearchType = Type.Object({
  tokens: Type.Optional(
    Type.Record(Type.String({ pattern: "^--[\\w-]+$" }), Type.String(), { minProperties: 1 }),
  ),
  css: Type.Optional(Type.String({ minLength: 1 })),
  /** False hides the prototype list. */
  rail: Type.Optional(Type.Literal(false)),
  /** True opens the inspector. */
  inspector: Type.Optional(Type.Literal(true)),
});

/**
 * The lab's state in the address, so a link reproduces the frame: token overrides, free CSS, and
 * which side panels are open. Each field is absent at its default, which keeps links short.
 */
export type LabSearch = Static<typeof LabSearchType>;

export const LAB_SEARCH_KEYS = ["tokens", "css", "rail", "inspector"] as const;

/** Keeps each field that parses and drops the rest, so a bad link still opens the lab. */
export function readLabSearch(search: Record<string, unknown>): LabSearch {
  const parsed = Object.fromEntries(
    LAB_SEARCH_KEYS.flatMap((key) =>
      Value.Check(LabSearchType.properties[key], search[key]) ? [[key, search[key]]] : [],
    ),
  );

  return Value.Check(LabSearchType, parsed) ? parsed : {};
}

/** The stylesheet the overrides become: tokens on every element so no scope escapes them. */
export function overrideSheet(search: LabSearch): string {
  const declarations = Object.entries(search.tokens ?? {})
    .map(([name, value]) => `${name}: ${value} !important;`)
    .join(" ");

  const tokens = declarations === "" ? "" : `*, *::before, *::after { ${declarations} }`;

  return [tokens, search.css ?? ""].filter((part) => part !== "").join("\n");
}
