/** Font selections: bundled stacks, the system stack, or one installed family the host listed. */
import { type } from "@nyte-ai/ui/vars.stylex";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const LOCAL_FONT_PREFIX = "local:";

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit <= 31 || codeUnit === 127) return true;
  }

  return false;
}

function usableFontFamily(family: string): boolean {
  return family !== "" && family.length <= 128 && !hasControlCharacter(family);
}

const LocalFontSelection = Type.Refine(
  Type.String(),
  (selection) =>
    selection.startsWith(LOCAL_FONT_PREFIX) &&
    usableFontFamily(selection.slice(LOCAL_FONT_PREFIX.length)),
);

type LocalFontSelection = Static<typeof LocalFontSelection>;

export const UiFontSchema = Type.Union([Type.Enum(["inter", "system"]), LocalFontSelection]);

export const CodeFontSchema = Type.Union([
  Type.Enum(["system", "jetbrains-mono"]),
  LocalFontSelection,
]);

export type UiFont = Static<typeof UiFontSchema>;

export type CodeFont = Static<typeof CodeFontSchema>;

export function localFontSelection(family: string): LocalFontSelection {
  const normalized = family.trim();

  if (!usableFontFamily(normalized)) throw new Error("Invalid local font family");

  return `${LOCAL_FONT_PREFIX}${normalized}`;
}

export function localFontFamily(selection: UiFont | CodeFont): string | undefined {
  return Value.Check(LocalFontSelection, selection)
    ? selection.slice(LOCAL_FONT_PREFIX.length)
    : undefined;
}

function quotedCssFamily(family: string): string {
  return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function uiFontFamily(selection: UiFont): string {
  const local = localFontFamily(selection);

  if (local !== undefined) return `${quotedCssFamily(local)}, system-ui, sans-serif`;

  return selection === "inter" ? type.uiFontInter : type.uiFontSystem;
}

export function codeFontFamily(selection: CodeFont): string {
  const local = localFontFamily(selection);

  if (local !== undefined) return `${quotedCssFamily(local)}, ui-monospace, monospace`;

  return selection === "jetbrains-mono" ? type.codeFontJetbrainsMono : type.codeFontSystem;
}
