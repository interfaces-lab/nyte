import tokensSource from "@nyte-ai/ui/styles/tokens.stylex?raw";

/*
 * The design site prints token values from the source that declares them, so
 * a page can never disagree with @nyte-ai/ui. A token is either one value or
 * a fine-pointer default with a coarse-pointer override.
 */

export interface DeclaredToken {
  name: string;
  value: string;
  coarse: string | undefined;
}

const quoted = String.raw`"([^"]*)"|'([^']*)'`;

const declaration = new RegExp(
  String.raw`"(--nyte-[\w-]+)":\s*(?:${quoted}|\{\s*default:\s*(?:${quoted}),\s*"@media \(pointer: coarse\)":\s*(?:${quoted}),?\s*\})`,
  "g",
);

const declared = new Map<string, DeclaredToken>();

for (const match of tokensSource.matchAll(declaration)) {
  const [, name, double, single, fineDouble, fineSingle, coarseDouble, coarseSingle] = match;
  const value = double ?? single ?? fineDouble ?? fineSingle;
  if (!name || value === undefined) continue;
  declared.set(name, { name, value, coarse: coarseDouble ?? coarseSingle });
}

export function declaredToken(name: string): DeclaredToken {
  const token = declared.get(name);
  if (!token) throw new Error(`@nyte-ai/ui declares no ${name}`);
  return token;
}

/** Every declared token whose name starts with `prefix`, in source order. */
export function declaredTokens(prefix: string): DeclaredToken[] {
  return [...declared.values()].filter((token) => token.name.startsWith(prefix));
}

/**
 * The px a type token resolves to at the default 13px UI size. Sizes are
 * written as `base * n / 13`, so at the default they are `n`.
 */
export function atDefaultSize(value: string): string {
  const ratio = /\* ([\d.]+) \/ \d+/.exec(value);
  return ratio ? `${ratio[1]}px` : value;
}
