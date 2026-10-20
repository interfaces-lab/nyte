import { readFile } from "node:fs/promises";
import type { WebContents } from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { BrowserElementPick } from "@nyte-ai/app/bridge.ts";
import { HTML_CHARS } from "../shared/browser-picker.ts";

const PICKER_WORLD_ID = 1_000;

let pickerScript: Promise<string> | undefined;

const CROP_WIDTH = 1_200;

const PickResultSchema = Type.Union([
  Type.Object({ kind: Type.Literal("cancelled") }),
  Type.Object({
    kind: Type.Literal("picked"),
    selector: Type.String({ minLength: 1, maxLength: 2_000 }),
    html: Type.String({ maxLength: HTML_CHARS + 1 }),
    rect: Type.Object({
      x: Type.Number(),
      y: Type.Number(),
      width: Type.Number(),
      height: Type.Number(),
    }),
  }),
]);

async function cropElement(
  contents: WebContents,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): Promise<string | undefined> {
  const zoom = contents.getZoomFactor();
  const x = Math.max(0, Math.floor(rect.x * zoom));
  const y = Math.max(0, Math.floor(rect.y * zoom));
  const width = Math.ceil((rect.x + rect.width) * zoom) - x;
  const height = Math.ceil((rect.y + rect.height) * zoom) - y;

  if (width < 1 || height < 1) return undefined;

  try {
    const image = await contents.capturePage({ x, y, width, height }, { stayHidden: true });

    if (image.isEmpty()) return undefined;
    const size = image.getSize();

    const kept =
      size.width > CROP_WIDTH ? image.resize({ width: CROP_WIDTH, quality: "good" }) : image;

    return kept.toDataURL();
  } catch {
    return undefined;
  }
}

export async function pickElement(contents: WebContents): Promise<BrowserElementPick | undefined> {
  let answer: unknown;

  try {
    pickerScript ??= readFile(new URL("./browser-picker-page.js", import.meta.url), "utf8");
    answer = await contents.executeJavaScriptInIsolatedWorld(PICKER_WORLD_ID, [
      { code: await pickerScript },
    ]);
  } catch {
    return undefined;
  }

  if (!Value.Check(Type.String(), answer)) return undefined;
  let parsed: unknown;

  try {
    parsed = JSON.parse(answer);
  } catch {
    return undefined;
  }

  if (!Value.Check(PickResultSchema, parsed) || parsed.kind === "cancelled") return undefined;

  return {
    url: contents.getURL(),
    selector: parsed.selector,
    html: parsed.html,
    image: await cropElement(contents, parsed.rect),
  };
}
