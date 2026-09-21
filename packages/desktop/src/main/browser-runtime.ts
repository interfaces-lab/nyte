/**
 * The browser runtime for one surface: snapshot refs and page scripts, CDP
 * input dispatch, and the actions the agent performs against a `WebContents`.
 *
 * Refs carry the snapshot generation so a stale ref fails loudly. The isolated
 * world shares the DOM but not the page's JS context, and is wiped by a
 * cross-document navigation — each injection is idempotent.
 *
 * All input goes through CDP, not sendInputEvent: CDP mouseWheel scrolls,
 * sendInputEvent mouseWheel does not.
 */
import type { WebContents } from "electron";
import type {
  BrowserActionFailure,
  BrowserActionResult,
  BrowserConsoleEntry,
  BrowserEvaluateResult,
  BrowserNode,
  BrowserPageState,
  BrowserRect,
  BrowserScrollInput,
  BrowserWaitInput,
} from "./browser-agent.ts";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { sanitizeLine } from "./browser-report.ts";

const REF_PREFIX = "s";
const SEP = "e";

/** Refs reach generated page code, so only this exact shape is ever accepted. */
const REF_PATTERN = /^s(\d{1,9})e(\d{1,9})$/;

function encodeRef(generation: number, index: number): string {
  return `${REF_PREFIX}${generation}${SEP}${index}`;
}

function decodeRef(
  ref: string,
): { readonly generation: number; readonly index: number } | undefined {
  const matched = REF_PATTERN.exec(ref);
  if (matched === null) return undefined;
  const generation = Number(matched[1]);
  const index = Number(matched[2]);
  if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(index)) return undefined;
  return { generation, index };
}

function classifyRef(ref: string, currentGeneration: number): "unknown_ref" | undefined {
  const decoded = decodeRef(ref);
  if (decoded === undefined) return "unknown_ref";
  if (decoded.generation !== currentGeneration) return "unknown_ref";
  return undefined;
}

const NAME_CAP = 200;

function escapeName(raw: string): string {
  const escaped = sanitizeLine(raw).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (escaped.length <= NAME_CAP) return escaped;
  return escaped.slice(0, NAME_CAP) + "\u2026";
}

function snapshotScript(generation: number, maxNodes: number, subtreeRef?: string): string {
  const sub = subtreeRef !== undefined ? JSON.stringify(subtreeRef) : "null";
  return `(function() {
  var G = ${generation}, M = ${maxNodes}, SUB = ${sub};
  if (!window.__nyte_doc_token) window.__nyte_doc_token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  if (!window.__nyte_refs) window.__nyte_refs = new Map();
  window.__nyte_refs.clear();
  var SKIP = new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","SVG"]);
  var ACTIONABLE = new Set(["link","button","textbox","searchbox","checkbox","radio","combobox","listbox","option","switch","slider","spinbutton","tab","menuitem"]);
  function clean(s) { return (s || "").replace(/\\s+/g, " ").trim(); }
  var SENS_AUTOCOMPLETE = new Set(["one-time-code","current-password","new-password"]);
  // A "show password" toggle flips type to text, so autocomplete decides too.
  function sensitive(el) {
    if ((el.type || "").toLowerCase() === "password") return true;
    return SENS_AUTOCOMPLETE.has((el.getAttribute("autocomplete") || "").trim().toLowerCase());
  }
  function vis(el) {
    if (el.offsetParent === null && !["fixed","sticky"].includes(getComputedStyle(el).position) && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    var s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.visibility !== "collapse" && parseFloat(s.opacity) !== 0;
  }
  function role(el) {
    var r = el.getAttribute("role");
    if (r) return r.split(/\\s+/)[0].toLowerCase();
    var t = el.tagName;
    if (t === "A" && el.hasAttribute("href")) return "link";
    if (t === "BUTTON") return "button";
    if (t === "INPUT") {
      var y = el.type || "text";
      return {checkbox:"checkbox",radio:"radio",range:"slider",number:"spinbutton",search:"searchbox",button:"button",submit:"button",reset:"button"}[y] || "textbox";
    }
    if (t === "TEXTAREA") return "textbox";
    if (t === "SELECT") return "combobox";
    var m = {IMG:"img",NAV:"navigation",MAIN:"main",HEADER:"banner",FOOTER:"contentinfo",ASIDE:"complementary",FORM:"form",TABLE:"table",TH:"columnheader",UL:"list",OL:"list",LI:"listitem",DIALOG:"dialog",OPTION:"option"}[t];
    if (m) return m;
    if (/^H[1-6]$/.test(t)) return "heading";
    if (t === "SECTION" && (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby"))) return "region";
    return "generic";
  }
  function nm(el) {
    var a = el.getAttribute("aria-label");
    if (a) return clean(a);
    var lb = el.getAttribute("aria-labelledby");
    if (lb) { var c = lb.split(/\\s+/).map(function(id) { return (document.getElementById(id) || {}).textContent || ""; }).join(" ").trim(); if (c) return clean(c); }
    if (el.tagName === "IMG") return clean(el.getAttribute("alt") || "");
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")
      return clean((el.labels && el.labels[0] ? el.labels[0].textContent : "") || el.getAttribute("placeholder") || el.getAttribute("title") || "");
    if (["A","BUTTON","OPTION"].includes(el.tagName) || /^H[1-6]$/.test(el.tagName)) return clean(el.textContent || "");
    return "";
  }
  function lvl(el) {
    var al = el.getAttribute("aria-level");
    if (al) return parseInt(al, 10) || undefined;
    var m = el.tagName.match(/^H([1-6])$/);
    return m ? parseInt(m[1], 10) : undefined;
  }
  var nodes = [], idx = 0;
  function walk(el) {
    if (SKIP.has(el.tagName) || !vis(el)) return;
    var r = role(el), n = nm(el);
    // An unnamed node the model cannot act on is noise repeated on every report.
    if (!n && !ACTIONABLE.has(r)) { for (var c of el.children) walk(c); return; }
    if (nodes.length >= M) return;
    var rect = el.getBoundingClientRect();
    var e = { index: idx, role: r, name: n.slice(0, 200), tag: el.tagName.toLowerCase(),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } };
    if (el.tagName === "A" && el.href) e.href = el.href;
    var l = lvl(el); if (l !== undefined) e.level = l;
    if (el.disabled === true) e.disabled = true;
    if (el.checked === true) e.checked = true;
    var ex = el.getAttribute("aria-expanded");
    if (ex === "true") e.expanded = true;
    if (ex === "false") e.expanded = false;
    if (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA") e.editable = true;
    if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") && el.value && !sensitive(el))
      e.value = el.value.slice(0, 500);
    window.__nyte_refs.set(idx, el);
    nodes.push(e); idx++;
    for (var c of el.children) walk(c);
  }
  var root = SUB !== null ? window.__nyte_refs.get(parseInt(SUB, 10)) : null;
  var base = root || document.body || document.documentElement;
  if (base) for (var c of base.children) walk(c);
  var text = (document.body || document.documentElement || {}).innerText || "";
  return JSON.stringify({ cmd: "snapshot", documentToken: window.__nyte_doc_token, nodes: nodes, totalNodes: idx,
    text: text.slice(0, 20000), viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { y: window.scrollY, height: document.documentElement.scrollHeight } });
})()`;
}

function checkScript(index: number): string {
  return `(function() {
  if (!window.__nyte_refs) return JSON.stringify({ cmd: "check", kind: "no_refs" });
  var el = window.__nyte_refs.get(${index});
  if (!el) return JSON.stringify({ cmd: "check", kind: "not_found" });
  if (!el.isConnected) return JSON.stringify({ cmd: "check", kind: "detached" });
  var rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return JSON.stringify({ cmd: "check", kind: "not_visible" });
  var cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  var hit = document.elementFromPoint(cx, cy);
  var occ = hit !== null && hit !== el && !el.contains(hit);
  var who = occ && hit ? { tag: hit.tagName.toLowerCase(), role: hit.getAttribute("role") || "",
    name: hit.getAttribute("aria-label") || (hit.textContent || "").slice(0, 100) } : null;
  return JSON.stringify({ cmd: "check", kind: "ok",
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    occluded: occ, occluder: who });
})()`;
}

function focusScript(index: number, clear: boolean): string {
  return `(function() {
  if (!window.__nyte_refs) return JSON.stringify({ cmd: "focus", kind: "no_refs" });
  var el = window.__nyte_refs.get(${index});
  if (!el) return JSON.stringify({ cmd: "focus", kind: "not_found" });
  if (!el.isConnected) return JSON.stringify({ cmd: "focus", kind: "detached" });
  el.focus();
  ${clear ? 'if ("value" in el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); }' : ""}
  return JSON.stringify({ cmd: "focus", kind: "ok" });
})()`;
}

function waitScript(until: "text" | "gone", text: string): string {
  const escaped = JSON.stringify(text);
  const check = until === "text" ? `text.includes(${escaped})` : `!text.includes(${escaped})`;
  return `(function() {
  var text = (document.body || document.documentElement || {}).innerText || "";
  return JSON.stringify({ cmd: "wait", found: ${check} });
})()`;
}

const RectSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number(),
  height: Type.Number(),
});

const SnapshotNodeSchema = Type.Object({
  index: Type.Number(),
  role: Type.String(),
  name: Type.String(),
  tag: Type.String(),
  rect: RectSchema,
  value: Type.Optional(Type.String()),
  href: Type.Optional(Type.String()),
  level: Type.Optional(Type.Number()),
  disabled: Type.Optional(Type.Boolean()),
  checked: Type.Optional(Type.Boolean()),
  expanded: Type.Optional(Type.Boolean()),
  editable: Type.Optional(Type.Boolean()),
});

const PageResultSchema = Type.Union([
  Type.Object({
    cmd: Type.Literal("snapshot"),
    documentToken: Type.String(),
    nodes: Type.Array(SnapshotNodeSchema),
    totalNodes: Type.Number(),
    text: Type.String(),
    viewport: Type.Object({ width: Type.Number(), height: Type.Number() }),
    scroll: Type.Object({ y: Type.Number(), height: Type.Number() }),
  }),
  Type.Object({
    cmd: Type.Literal("check"),
    kind: Type.Literal("ok"),
    rect: RectSchema,
    occluded: Type.Boolean(),
    occluder: Type.Union([
      Type.Null(),
      Type.Object({ tag: Type.String(), role: Type.String(), name: Type.String() }),
    ]),
  }),
  Type.Object({
    cmd: Type.Literal("check"),
    kind: Type.Union([
      Type.Literal("no_refs"),
      Type.Literal("not_found"),
      Type.Literal("detached"),
      Type.Literal("not_visible"),
    ]),
  }),
  Type.Object({
    cmd: Type.Literal("focus"),
    kind: Type.Union([
      Type.Literal("ok"),
      Type.Literal("no_refs"),
      Type.Literal("not_found"),
      Type.Literal("detached"),
    ]),
  }),
  Type.Object({ cmd: Type.Literal("wait"), found: Type.Boolean() }),
]);

type PageResult = Static<typeof PageResultSchema>;
type SnapshotResult = Extract<PageResult, { cmd: "snapshot" }>;

function parsePageResult(json: string): PageResult {
  const raw: unknown = JSON.parse(json);
  return Value.Parse(PageResultSchema, raw);
}

function buildNodes(generation: number, rawNodes: SnapshotResult["nodes"]): readonly BrowserNode[] {
  return rawNodes.map((raw) => {
    const node: BrowserNode = {
      ref: encodeRef(generation, raw.index),
      role: raw.role,
      name: escapeName(raw.name),
      tag: raw.tag,
      rect: raw.rect,
      ...(raw.value !== undefined ? { value: raw.value } : {}),
      ...(raw.href !== undefined ? { href: raw.href } : {}),
      ...(raw.level !== undefined ? { level: raw.level } : {}),
      ...(raw.disabled !== undefined ? { disabled: raw.disabled } : {}),
      ...(raw.checked !== undefined ? { checked: raw.checked } : {}),
      ...(raw.expanded !== undefined ? { expanded: raw.expanded } : {}),
      ...(raw.editable !== undefined ? { editable: raw.editable } : {}),
    };
    return node;
  });
}

interface CdpKeyDescriptor {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly text?: string;
}

/** Only the named keys an agent presses. Text entry uses CDP Input.insertText. */
const KEY_MAP: ReadonlyMap<string, CdpKeyDescriptor> = new Map([
  ["Enter", { key: "Enter", code: "Enter", keyCode: 13, text: "\r" }],
  ["Tab", { key: "Tab", code: "Tab", keyCode: 9 }],
  ["Backspace", { key: "Backspace", code: "Backspace", keyCode: 8 }],
  ["Delete", { key: "Delete", code: "Delete", keyCode: 46 }],
  ["Escape", { key: "Escape", code: "Escape", keyCode: 27 }],
  ["ArrowUp", { key: "ArrowUp", code: "ArrowUp", keyCode: 38 }],
  ["ArrowDown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40 }],
  ["ArrowLeft", { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 }],
  ["ArrowRight", { key: "ArrowRight", code: "ArrowRight", keyCode: 39 }],
]);

function resolveKey(name: string): CdpKeyDescriptor | undefined {
  return KEY_MAP.get(name);
}

const MODIFIER_BITS: ReadonlyMap<string, number> = new Map([
  ["Alt", 1],
  ["Control", 2],
  ["Ctrl", 2],
  ["Meta", 4],
  ["Cmd", 4],
  ["Command", 4],
  ["Shift", 8],
]);

function parseKeyExpression(
  expression: string,
): { readonly modifiers: number; readonly key: string } | undefined {
  const parts = expression.split("+");
  const keyPart = parts[parts.length - 1];
  if (keyPart === undefined || keyPart === "") return undefined;
  let modifiers = 0;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const bit = MODIFIER_BITS.get(parts[i] ?? "");
    if (bit === undefined) return undefined;
    modifiers |= bit;
  }
  return { modifiers, key: keyPart };
}

function cdpMouseButton(button: string): string {
  if (button === "right") return "right";
  if (button === "middle") return "middle";
  return "left";
}

function scrollDelta(
  direction: "up" | "down" | "top" | "bottom",
  viewportHeight: number,
  scrollHeight: number,
  scrollY: number,
  pages?: number,
): { readonly deltaX: number; readonly deltaY: number } {
  const perPage = viewportHeight > 0 ? viewportHeight : 600;
  const count = pages ?? 1;
  switch (direction) {
    case "up":
      return { deltaX: 0, deltaY: -(perPage * count) };
    case "down":
      return { deltaX: 0, deltaY: perPage * count };
    case "top":
      return { deltaX: 0, deltaY: -scrollY };
    case "bottom":
      return { deltaX: 0, deltaY: Math.max(0, scrollHeight - scrollY - viewportHeight) };
  }
}

const ISOLATED_WORLD_ID = 999;
const MAX_SNAPSHOT_NODES = 500;
const CONSOLE_RING_SIZE = 200;
const CAPTURE_SCALE = 0.5;

const CLOSED = { kind: "failed", failure: { kind: "closed" } } as const;

export interface SurfaceRuntime {
  generation: number;
  documentToken: string | undefined;
  lastSnapshot: SnapshotResult | undefined;
  consoleBuffer: BrowserConsoleEntry[];
  debuggerAttached: boolean;
  blocked: number;
  error: { readonly code: number; readonly description: string } | undefined;
}

export function createSurfaceRuntime(): SurfaceRuntime {
  return {
    generation: 0,
    documentToken: undefined,
    lastSnapshot: undefined,
    consoleBuffer: [],
    debuggerAttached: false,
    blocked: 0,
    error: undefined,
  };
}

export function attachConsoleCapture(contents: WebContents, runtime: SurfaceRuntime): void {
  contents.on("console-message", (_event, level, message, _line, sourceId) => {
    const entry: BrowserConsoleEntry = {
      level: level >= 3 ? "error" : level === 2 ? "warning" : level === 0 ? "debug" : "info",
      message: message.slice(0, 2000),
      source: sourceId.slice(0, 200),
      at: Date.now(),
    };
    runtime.consoleBuffer.unshift(entry);
    if (runtime.consoleBuffer.length > CONSOLE_RING_SIZE) {
      runtime.consoleBuffer.length = CONSOLE_RING_SIZE;
    }
  });
}

function ensureDebugger(contents: WebContents, runtime: SurfaceRuntime): void {
  if (runtime.debuggerAttached) return;
  if (contents.isDestroyed()) return;
  try {
    contents.debugger.attach("1.3");
  } catch {
    // DevTools or another client holds it; isAttached below decides whether we can send.
  }
  runtime.debuggerAttached = contents.debugger.isAttached();
}

function emptyState(contents: WebContents, runtime: SurfaceRuntime, gen: number): BrowserPageState {
  const dead = contents.isDestroyed();
  return {
    url: dead ? "" : contents.getURL(),
    title: dead ? "" : contents.getTitle(),
    loading: dead ? false : contents.isLoading(),
    snapshot: gen,
    viewport: { width: 0, height: 0 },
    scroll: { y: 0, height: 0 },
    nodes: [],
    totalNodes: 0,
    text: "",
    blocked: runtime.blocked,
    error: runtime.error,
  };
}

async function cdpSend(
  contents: WebContents,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return contents.debugger.sendCommand(method, params);
}

async function cdpClick(
  contents: WebContents,
  x: number,
  y: number,
  button: string,
  clickCount: number,
): Promise<void> {
  await cdpSend(contents, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button,
    clickCount,
  });
  await cdpSend(contents, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button,
    clickCount,
  });
}

async function cdpKey(
  contents: WebContents,
  descriptor: {
    readonly key: string;
    readonly code: string;
    readonly keyCode: number;
    readonly text?: string;
  },
  modifiers?: number,
): Promise<void> {
  await cdpSend(contents, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: descriptor.key,
    code: descriptor.code,
    windowsVirtualKeyCode: descriptor.keyCode,
    nativeVirtualKeyCode: descriptor.keyCode,
    text: descriptor.text ?? "",
    modifiers: modifiers ?? 0,
  });
  await cdpSend(contents, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: descriptor.key,
    code: descriptor.code,
    windowsVirtualKeyCode: descriptor.keyCode,
    nativeVirtualKeyCode: descriptor.keyCode,
    modifiers: modifiers ?? 0,
  });
}

export async function takeSnapshot(
  contents: WebContents,
  runtime: SurfaceRuntime,
  subtreeRef?: string,
): Promise<BrowserPageState> {
  runtime.generation += 1;
  const gen = runtime.generation;

  let subtreeIndex: string | undefined;
  if (subtreeRef !== undefined) {
    const decoded = decodeRef(subtreeRef);
    if (decoded !== undefined) subtreeIndex = String(decoded.index);
  }

  const script = snapshotScript(gen, MAX_SNAPSHOT_NODES, subtreeIndex);
  const resultJson: unknown = await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
    { code: script },
  ]);

  if (typeof resultJson !== "string") return emptyState(contents, runtime, gen);

  const result = parsePageResult(resultJson);
  if (result.cmd !== "snapshot") return emptyState(contents, runtime, gen);

  runtime.lastSnapshot = result;
  runtime.documentToken = result.documentToken;
  return {
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
    snapshot: gen,
    viewport: result.viewport,
    scroll: result.scroll,
    nodes: buildNodes(gen, result.nodes),
    totalNodes: result.totalNodes,
    text: result.text,
    blocked: runtime.blocked,
    error: runtime.error,
  };
}

async function checkElement(
  contents: WebContents,
  runtime: SurfaceRuntime,
  ref: string,
): Promise<
  | { readonly kind: "ok"; readonly rect: BrowserRect }
  | { readonly kind: "failed"; readonly failure: BrowserActionFailure }
> {
  const decoded = decodeRef(ref);
  if (decoded === undefined) return { kind: "failed", failure: { kind: "unknown_ref", ref } };

  const classification = classifyRef(ref, runtime.generation);
  if (classification === "unknown_ref")
    return { kind: "failed", failure: { kind: "unknown_ref", ref } };

  const script = checkScript(decoded.index);
  const resultJson: unknown = await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
    { code: script },
  ]);
  if (typeof resultJson !== "string") {
    return { kind: "failed", failure: { kind: "stale_document", ref } };
  }

  const check = parsePageResult(resultJson);
  if (check.cmd !== "check") return { kind: "failed", failure: { kind: "stale_document", ref } };

  if (check.kind !== "ok") {
    if (check.kind === "not_found" || check.kind === "no_refs")
      return { kind: "failed", failure: { kind: "unknown_ref", ref } };
    if (check.kind === "detached") return { kind: "failed", failure: { kind: "detached", ref } };
    return { kind: "failed", failure: { kind: "not_visible", ref } };
  }

  if (check.occluded && check.occluder !== null) {
    return {
      kind: "failed",
      failure: {
        kind: "occluded",
        ref,
        by: { role: check.occluder.role || check.occluder.tag, name: check.occluder.name },
      },
    };
  }
  return { kind: "ok", rect: check.rect };
}

export async function performClick(
  contents: WebContents,
  runtime: SurfaceRuntime,
  ref: string,
  button: string,
  double: boolean,
  windowShown: boolean,
  signal?: AbortSignal,
): Promise<BrowserActionResult> {
  if (contents.isDestroyed()) return CLOSED;
  if (!windowShown) return { kind: "failed", failure: { kind: "no_window" } };
  ensureDebugger(contents, runtime);

  const check = await checkElement(contents, runtime, ref);
  if (check.kind === "failed") return check;
  if (signal?.aborted) return CLOSED;

  const cx = check.rect.x + check.rect.width / 2;
  const cy = check.rect.y + check.rect.height / 2;
  await cdpClick(contents, cx, cy, cdpMouseButton(button), double ? 2 : 1);
  await sleep(100, signal);
  return { kind: "ok", state: await takeSnapshot(contents, runtime) };
}

export async function performType(
  contents: WebContents,
  runtime: SurfaceRuntime,
  ref: string,
  text: string,
  clear: boolean,
  submit: boolean,
  windowShown: boolean,
  signal?: AbortSignal,
): Promise<BrowserActionResult> {
  if (contents.isDestroyed()) return CLOSED;
  if (!windowShown) return { kind: "failed", failure: { kind: "no_window" } };
  ensureDebugger(contents, runtime);

  const check = await checkElement(contents, runtime, ref);
  if (check.kind === "failed") return check;
  if (signal?.aborted) return CLOSED;

  const decoded = decodeRef(ref);
  if (decoded === undefined) return { kind: "failed", failure: { kind: "unknown_ref", ref } };

  const focusCode = focusScript(decoded.index, clear);
  const focusJson: unknown = await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
    { code: focusCode },
  ]);
  if (typeof focusJson === "string") {
    const focusResult = parsePageResult(focusJson);
    if (focusResult.cmd !== "focus" || focusResult.kind !== "ok") {
      return { kind: "failed", failure: { kind: "detached", ref } };
    }
  }

  // insertText goes to whatever the page has focused, and only a click moves focus reliably.
  const cx = check.rect.x + check.rect.width / 2;
  const cy = check.rect.y + check.rect.height / 2;
  await cdpClick(contents, cx, cy, "left", 1);
  await cdpSend(contents, "Input.insertText", { text });

  if (submit) {
    const enterKey = resolveKey("Enter");
    if (enterKey !== undefined) await cdpKey(contents, enterKey);
  }

  await sleep(100, signal);
  return { kind: "ok", state: await takeSnapshot(contents, runtime) };
}

export async function performPress(
  contents: WebContents,
  runtime: SurfaceRuntime,
  keyExpression: string,
  ref: string | undefined,
  windowShown: boolean,
  signal?: AbortSignal,
): Promise<BrowserActionResult> {
  if (contents.isDestroyed()) return CLOSED;
  if (!windowShown) return { kind: "failed", failure: { kind: "no_window" } };
  ensureDebugger(contents, runtime);

  if (ref !== undefined) {
    const check = await checkElement(contents, runtime, ref);
    if (check.kind === "failed") return check;
    if (signal?.aborted) return CLOSED;
    const cx = check.rect.x + check.rect.width / 2;
    const cy = check.rect.y + check.rect.height / 2;
    await cdpClick(contents, cx, cy, "left", 1);
  }

  const parsed = parseKeyExpression(keyExpression);
  if (parsed !== undefined) {
    const descriptor = resolveKey(parsed.key);
    if (descriptor !== undefined) await cdpKey(contents, descriptor, parsed.modifiers);
  }

  await sleep(100, signal);
  return { kind: "ok", state: await takeSnapshot(contents, runtime) };
}

export async function performScroll(
  contents: WebContents,
  runtime: SurfaceRuntime,
  input: BrowserScrollInput,
  windowShown: boolean,
  signal?: AbortSignal,
): Promise<BrowserActionResult> {
  if (contents.isDestroyed()) return CLOSED;
  if (!windowShown) return { kind: "failed", failure: { kind: "no_window" } };
  ensureDebugger(contents, runtime);

  let targetX = 400;
  let targetY = 300;
  if (input.ref !== undefined) {
    const check = await checkElement(contents, runtime, input.ref);
    if (check.kind === "failed") return check;
    targetX = check.rect.x + check.rect.width / 2;
    targetY = check.rect.y + check.rect.height / 2;
  }

  const vh = runtime.lastSnapshot?.viewport.height ?? 800;
  const sh = runtime.lastSnapshot?.scroll.height ?? 3000;
  const sy = runtime.lastSnapshot?.scroll.y ?? 0;
  const delta = scrollDelta(input.direction, vh, sh, sy, input.pages);

  if (delta.deltaY !== 0 || delta.deltaX !== 0) {
    await cdpSend(contents, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: targetX,
      y: targetY,
      deltaX: delta.deltaX,
      deltaY: delta.deltaY,
    });
  }

  await sleep(200, signal);
  return { kind: "ok", state: await takeSnapshot(contents, runtime) };
}

export async function performWait(
  contents: WebContents,
  runtime: SurfaceRuntime,
  input: BrowserWaitInput,
  signal?: AbortSignal,
): Promise<BrowserActionResult> {
  if (contents.isDestroyed()) return CLOSED;

  if (input.until === "load") {
    await waitForLoad(contents, signal);
    if (contents.isDestroyed()) return CLOSED;
    return { kind: "ok", state: await takeSnapshot(contents, runtime) };
  }

  if (input.until === "time") {
    await sleep(input.seconds * 1000, signal);
    if (contents.isDestroyed()) return CLOSED;
    return { kind: "ok", state: await takeSnapshot(contents, runtime) };
  }

  const deadline = Date.now() + 15_000;
  let delay = 200;
  while (Date.now() < deadline) {
    if (signal?.aborted) break;
    if (contents.isDestroyed()) return CLOSED;
    const script = waitScript(input.until, input.text);
    const resultJson: unknown = await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
      { code: script },
    ]);
    if (typeof resultJson === "string") {
      const result = parsePageResult(resultJson);
      if (result.cmd === "wait" && result.found) break;
    }
    await sleep(delay, signal);
    delay = Math.min(delay * 1.5, 2000);
  }

  return { kind: "ok", state: await takeSnapshot(contents, runtime) };
}

const LOAD_LIMIT_MS = 30_000;

/** Every exit clears the timer and listeners; a view destroyed mid-load fires only `destroyed`. */
function waitForLoad(contents: WebContents, signal?: AbortSignal): Promise<void> {
  if (contents.isDestroyed() || !contents.isLoading() || signal?.aborted === true) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      contents.removeListener("did-stop-loading", done);
      contents.removeListener("destroyed", done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, LOAD_LIMIT_MS);
    contents.on("did-stop-loading", done);
    contents.on("destroyed", done);
    signal?.addEventListener("abort", done, { once: true });
  });
}

const EvalResultSchema = Type.Union([
  Type.Object({ v: Type.Unknown() }),
  Type.Object({ e: Type.String() }),
]);

export async function performEvaluate(
  contents: WebContents,
  runtime: SurfaceRuntime,
  expression: string,
  ref: string | undefined,
): Promise<BrowserEvaluateResult> {
  if (contents.isDestroyed()) return { kind: "threw", message: "Page is closed" };
  ensureDebugger(contents, runtime);

  let wrapped = expression;
  if (ref !== undefined) {
    const decoded = decodeRef(ref);
    if (decoded === undefined)
      return { kind: "threw", message: `Unknown ref: ${sanitizeLine(ref)}` };
    wrapped = `(function() {
      var el = window.__nyte_refs?.get(${decoded.index});
      if (!el) throw new Error("Unknown ref");
      return (function() { ${expression} }).call(el);
    })()`;
  }

  try {
    const result: unknown = await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
      {
        code: `JSON.stringify((function() { try { return { v: (${wrapped}) }; } catch(e) { return { e: String(e) }; } })())`,
      },
    ]);
    if (typeof result !== "string")
      return { kind: "threw", message: "Evaluation returned no result" };
    const parsed = Value.Parse(EvalResultSchema, JSON.parse(result));
    if ("e" in parsed) return { kind: "threw", message: parsed.e };
    return { kind: "value", json: JSON.stringify(parsed.v) };
  } catch (error) {
    return { kind: "threw", message: error instanceof Error ? error.message : String(error) };
  }
}

export async function performCapture(contents: WebContents): Promise<Uint8Array | undefined> {
  if (contents.isDestroyed()) return undefined;
  try {
    const image = await contents.capturePage(undefined, { stayHidden: true });
    if (image.isEmpty()) return undefined;
    const size = image.getSize();
    const w = Math.max(1, Math.round(size.width * CAPTURE_SCALE));
    const h = Math.max(1, Math.round(size.height * CAPTURE_SCALE));
    return new Uint8Array(image.resize({ width: w, height: h }).toPNG());
  } catch {
    return undefined;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
