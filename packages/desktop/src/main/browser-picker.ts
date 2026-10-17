/**
 * Picking an element on a browser panel's page for the chat. A page script in
 * its own isolated world outlines what the pointer is over; a click or Enter
 * picks it, ArrowUp and ArrowDown move to its parent or first child, and
 * Escape cancels. Only the user's own input counts: a click or key the page
 * dispatches itself is ignored, so the page cannot choose what is picked.
 * Running the script while a pick is open cancels that pick, so one chord
 * starts and stops it. The page never sees the clicks it takes,
 * and the script answers only once the outline is off the screen, so the crop
 * shows the element alone.
 *
 * What comes back is page content, so it is parsed here before it leaves main:
 * a selector that finds the element, its outer HTML cut to `HTML_CHARS`, and a
 * PNG of the element's box cropped from the page.
 */
import { readFile } from "node:fs/promises";
import type { WebContents } from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { BrowserElementPick } from "@nyte-ai/app/bridge.ts";
import { HTML_CHARS } from "../shared/browser-picker.ts";

/** Its own world: the agent runtime's world keeps its refs, and a pick never disturbs them. */
const PICKER_WORLD_ID = 1_000;

/** The page script (`browser-picker-page.ts`), read from beside main on the first pick. */
let pickerScript: Promise<string> | undefined;

/** The widest crop kept, in pixels; a wider element is scaled down to it. */
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

/** The element's box cropped from the page as a PNG data URL, once the outline is gone; none for an empty or off-screen box. */
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

/** Waits for the user to pick an element on the page, or to cancel; a page that navigates away mid-pick cancels it. */
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
