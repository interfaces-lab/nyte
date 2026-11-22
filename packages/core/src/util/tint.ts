import { oklch } from "culori/css";
import type { SettingTint } from "@nyte-ai/schema";

/** A CSS colour's OKLCH hue and chroma, or `undefined` when there is no colour or it doesn't parse. */
export function readTint(color: string | undefined): SettingTint | undefined {
  const parsed = color === undefined ? undefined : oklch(color);

  return parsed === undefined ? undefined : { hue: parsed.h ?? 0, chroma: parsed.c };
}
