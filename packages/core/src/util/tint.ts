import { oklch } from "culori/css";
import type { SettingTint } from "@nyte-ai/schema";

/** A CSS colour's OKLCH hue and chroma, or `undefined` when there is no colour or it doesn't parse. */
export function readTint(color: string | undefined): SettingTint | undefined {
  const parsed = color === undefined ? undefined : oklch(color);

  return parsed === undefined
    ? undefined
    : { hue: readChannel(parsed.h), chroma: readChannel(parsed.c) };
}

function readChannel(channel: number | undefined): number {
  return channel !== undefined && Number.isFinite(channel) ? channel : 0;
}
