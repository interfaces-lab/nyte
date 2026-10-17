/**
 * Picking an element on a browser panel's page for the chat. A page script in
 * its own isolated world outlines what the pointer is over; a click or Enter
 * picks it, ArrowUp and ArrowDown move to its parent or first child, and
 * Escape cancels. Running the script while a pick is open cancels that pick,
 * so one chord starts and stops it. The page never sees the clicks it takes,
 * and the script answers only once the outline is off the screen, so the crop
 * shows the element alone.
 *
 * What comes back is page content, so it is parsed here before it leaves main:
 * a selector that finds the element, its outer HTML cut to `HTML_CHARS`, and a
 * PNG of the element's box cropped from the page.
 */
import type { WebContents } from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { BrowserElementPick } from "@nyte-ai/app/bridge.ts";

/** Its own world: the agent runtime's world keeps its refs, and a pick never disturbs them. */
const PICKER_WORLD_ID = 1_000;

const HTML_CHARS = 4_000;

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

const PICKER_SCRIPT = `(() => {
  const open = window.__nytePick;
  if (typeof open === "function") {
    open();
    return Promise.resolve(JSON.stringify({ kind: "cancelled" }));
  }
  const accent = "#3884ff";
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;border:2px solid " + accent + ";background:rgba(56,132,255,.12);border-radius:2px;display:none";
  const tag = document.createElement("div");
  tag.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;font:12px/16px ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;background:" + accent + ";padding:1px 4px;border-radius:2px;display:none;max-width:60vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis";
  document.documentElement.append(box, tag);
  const step = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    let part = element.localName;
    for (const name of [...element.classList].slice(0, 2)) part += "." + CSS.escape(name);
    const parent = element.parentElement;
    if (parent !== null) {
      const same = [...parent.children].filter((child) => child.localName === element.localName);
      if (same.length > 1) part += ":nth-of-type(" + String(same.findIndex((child) => child === element) + 1) + ")";
    }
    return part;
  };
  const selectorFor = (element) => {
    const parts = [];
    for (let node = element; node !== null && node !== document.documentElement; node = node.parentElement) {
      parts.unshift(step(node));
      const selector = parts.join(" > ");
      try {
        if (document.querySelectorAll(selector).length === 1) return selector;
      } catch {}
    }
    return parts.join(" > ") || element.localName;
  };
  let current = null;
  const show = (element) => {
    if (element === null || element === box || element === tag) return;
    current = element;
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px" });
    tag.textContent = step(element);
    Object.assign(tag.style, { display: "block", left: Math.max(0, rect.left) + "px", top: (rect.top >= 20 ? rect.top - 20 : rect.bottom + 2) + "px" });
  };
  const block = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };
  return new Promise((resolve) => {
    const finish = (result) => {
      for (const [type, listener] of listeners) window.removeEventListener(type, listener, true);
      box.remove();
      tag.remove();
      delete window.__nytePick;
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(JSON.stringify(result))));
    };
    const pick = () => {
      if (current === null) return;
      const rect = current.getBoundingClientRect();
      const html = current.outerHTML;
      finish({
        kind: "picked",
        selector: selectorFor(current),
        html: html.length > ${String(HTML_CHARS)} ? html.slice(0, ${String(HTML_CHARS)}) + "…" : html,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      });
    };
    const listeners = [
      ["mousemove", (event) => show(document.elementFromPoint(event.clientX, event.clientY))],
      ["pointerdown", block],
      ["mousedown", block],
      ["pointerup", block],
      ["mouseup", block],
      ["click", (event) => {
        block(event);
        show(document.elementFromPoint(event.clientX, event.clientY));
        pick();
      }],
      ["keydown", (event) => {
        if (event.key === "Escape") {
          block(event);
          finish({ kind: "cancelled" });
        } else if (event.key === "Enter") {
          block(event);
          pick();
        } else if (event.key === "ArrowUp" && current?.parentElement && current.parentElement !== document.documentElement) {
          block(event);
          show(current.parentElement);
        } else if (event.key === "ArrowDown" && current?.firstElementChild) {
          block(event);
          show(current.firstElementChild);
        }
      }],
    ];
    for (const [type, listener] of listeners) window.addEventListener(type, listener, true);
    window.__nytePick = () => finish({ kind: "cancelled" });
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) show(focused);
  });
})()`;

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
    answer = await contents.executeJavaScriptInIsolatedWorld(PICKER_WORLD_ID, [
      { code: PICKER_SCRIPT },
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
