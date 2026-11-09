import { CANVAS_LIBRARY_VERSIONS } from "./canvas-libraries.ts";

export const CANVAS_RUNTIME = 2;

export const CANVAS_GLOBAL = "__nyteCanvas";

export const CANVAS_STARTUP_CONTEXT = "__nyteCanvasContext";

export const KIT_SPECIFIER = "nyte/canvas";

export const CANVAS_ENTRY = "main.tsx";

export const CANVAS_SOURCE_LIMIT = 65_536;

export const CANVAS_CODE_LIMIT = 196_608;

export const CANVAS_MIN_HEIGHT = 48;

export const CANVAS_MAX_HEIGHT = 2000;

export const CANVAS_MIN_HEIGHT_HINT = 80;

export const CANVAS_DEFAULT_HEIGHT = 80;

export const REACT_EXPORTS = [
  "Activity",
  "Children",
  "Component",
  "Fragment",
  "Profiler",
  "PureComponent",
  "StrictMode",
  "Suspense",
  "ViewTransition",
  "addTransitionType",
  "cache",
  "cloneElement",
  "createContext",
  "createElement",
  "createRef",
  "forwardRef",
  "isValidElement",
  "lazy",
  "memo",
  "startTransition",
  "use",
  "useActionState",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useEffectEvent",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
] as const;

export const JSX_RUNTIME_EXPORTS = ["Fragment", "jsx", "jsxs"] as const;

export const REACT_DOM_EXPORTS = ["createPortal", "flushSync"] as const;

export type CanvasLibrary = keyof typeof CANVAS_LIBRARY_VERSIONS;

const CANVAS_LIBRARY_NAMES = Object.keys(CANVAS_LIBRARY_VERSIONS).filter(
  (name): name is CanvasLibrary => Object.hasOwn(CANVAS_LIBRARY_VERSIONS, name),
);

export function readCanvasLibrary(value: unknown): CanvasLibrary | undefined {
  return CANVAS_LIBRARY_NAMES.find((name) => name === value);
}

export const LIBRARY_VERSIONS: Readonly<Record<string, string>> = CANVAS_LIBRARY_VERSIONS;

const FILES_COMMENT = /^\/\*nyte-canvas-files:(\[[^\n]*?\])\*\//u;

export type CanvasFileSpan = readonly [file: string, start: number, lines: number];

export function canvasFilesComment(spans: readonly CanvasFileSpan[]): string {
  return `/*nyte-canvas-files:${JSON.stringify(spans)}*/`;
}

export function locateCanvasStack(code: string, stack: string): string | undefined {
  const comment = FILES_COMMENT.exec(code);

  if (comment === null) return undefined;
  const spans = parseSpans(comment[1] ?? "");

  for (const frame of stack.matchAll(/blob:[^\s)]+:(\d+):\d+/gu)) {
    const line = Number(frame[1]);
    const span = spans.find(([, start, lines]) => line >= start && line < start + lines);

    if (span !== undefined) return `${span[0]}:${line - span[1] + 1}`;
  }

  return undefined;
}

function parseSpans(text: string): readonly CanvasFileSpan[] {
  try {
    const parsed: unknown = JSON.parse(text);

    return Array.isArray(parsed)
      ? parsed.flatMap((entry: unknown): CanvasFileSpan[] =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          typeof entry[1] === "number" &&
          typeof entry[2] === "number"
            ? [[entry[0], entry[1], entry[2]]]
            : [],
        )
      : [];
  } catch {
    return [];
  }
}

export const TINTS = [
  "blue",
  "pink",
  "orange",
  "teal",
  "red",
  "yellow",
  "purple",
  "green",
  "gray",
  "brown",
] as const;

export const KIT = {
  Stack:
    '{ direction?: "row" | "column" = "column", gap?: 0 | 1 | 2 | 3 | 4 | 6 = 2 (×4 px), align?: "start" | "center" | "end" | "stretch", justify?: "start" | "center" | "end" | "between", wrap?: boolean, children }: flex layout',
  Grid: '{ columns?: number | "auto" = "auto", minWidth?: number = 160 (px, with "auto"), gap?: 0 | 1 | 2 | 3 | 4 | 6 = 2, children }: equal columns',
  Divider: "{}: a hairline",
  Panes:
    '{ areas: string[], rows?: (number | "auto")[], children: Pane[] }: panes split by hairlines, with no cards, for a dense dashboard. Each string in `areas` is a row of space-separated pane names, as in CSS `grid-template-areas`; `rows` gives each row a height in px. Below 600 px wide the panes stack in source order',
  Pane: "{ area: string, title?: ReactNode, actions?: ReactNode, flush?: boolean, height?: number, children }: one pane of Panes, with a small header when it has a title or actions. `flush` drops the padding for a chart or list that runs to the edges; `height` is its height in px once the panes stack, which a chart that fills its pane needs",
  Heading: "{ level?: 1 | 2 | 3 = 2, children }",
  Text: '{ size?: "xs" | "sm" | "base" | "lg", tone?: "primary" | "secondary" | "tertiary", weight?: "normal" | "medium" | "semibold", mono?: boolean, truncate?: boolean, align?: "start" | "center" | "end", children }',
  Code: "{ block?: boolean, title?: string, children: string }: monospace, inline or a block; `title` heads a block with the file it came from",
  FileLink:
    "{ path: string, line?: number, symbol?: string }: a workspace file, drawn like a file mention in the chat, that opens at `line`; `symbol` names the function there. Use it for every path instead of mono text",
  Stat: '{ label: string, value: ReactNode, detail?: ReactNode, tone?: "neutral" | "success" | "warning" | "danger", delta?: string | number, invert?: boolean, trend?: number[] }: a labelled number; `delta` adds a change chip coloured by its sign (`invert` when down is good), `trend` a sparkline beside the value',
  Delta:
    "{ value: string | number, invert?: boolean }: a change chip, green when the change is good, read from the sign it is written with; a number gets its sign written for it",
  Badge:
    '{ tone?: "neutral" | "info" | "success" | "warning" | "danger", dot?: boolean, children }: a short status; `dot` leads it with a status mark',
  Meter:
    '{ value: number, max?: number = 100, label?: string, detail?: ReactNode, tone?: "primary" | "success" | "warning" | "danger" = "primary" }: a share of a whole with the percentage beside the label; `detail` names the units, as in "124k of 200k"',
  Table:
    '{ columns: { key: string, label: ReactNode, align?: "start" | "end", width?: number | string }[], rows: Record<string, ReactNode>[], caption?: string }: rows are keyed by column key; a cell can hold a Sparkline, Badge, Delta or DiffStat. The edge cells line up with the text around the table, and with the title inside a `padding={0}` Card',
  KeyValue:
    "{ items: { label: ReactNode, value: ReactNode }[] }: labelled facts, one per row with the value at the end; use it instead of a two-column Table",
  DiffStat:
    "{ added: number, removed: number }: lines added and removed, with five blocks split between them as GitHub draws it",
  BarList:
    '{ data: { label: string, value: number }[], format?: (value: number) => string, tint?: Tint = "blue" }: a ranked list, each label on a bar sized to its share of the largest value; for a top-N list instead of a horizontal BarChart',
  Steps:
    '{ items: { title: ReactNode, body?: ReactNode, meta?: ReactNode, status?: "done" | "current" | "todo" }[] }: an ordered walk through a process on a numbered rail, instead of a Card per step; `meta` holds a FileLink or a Badge',
  Tracker:
    '{ label: string, data: { tone: "success" | "warning" | "danger" | "neutral", label: string }[] }: one cell per run, check or day, coloured by how it went and named on hover',
  Callout:
    '{ tone?: "info" | "success" | "warning" | "danger", title?: string, children }: a note in the reading flow, a soft wash led by its tone glyph',
  Card: "{ title?: ReactNode, description?: ReactNode, actions?: ReactNode, padding?: 0 | 2 | 3 | 4 = 4, children }: a raised surface for one idea; with `padding={0}` its content runs edge to edge under a ruled header",
  Section:
    "{ title: ReactNode, description?: ReactNode, actions?: ReactNode, children }: a titled group, the heading with an optional line under it and actions at the end, then the content",
  StackedBars:
    "{ label: string, series: { key: string, label: string, tint: Tint }[], buckets: { key: string, label: string, values: number[] }[], format: (value: number) => string, height?: number = 88, ticks?: number = 5 }: compact stacked bars without axes, a readout on pointer or arrow keys; the numbers live in the copy around it. Preferred beside a Stat or a heading figure",
  Sparkline:
    "{ values: number[], tint?: Tint, label?: string, width?: number = 72, height?: number = 20 }: a row's trend scaled to its own peak, for a Table cell beside the row's number",
  LineChart:
    '{ series: { id: string, data: { x: number | string, y: number }[], tint?: Tint }[], height?: number = 240, xFormat?: (x) => string, yFormat?: (y) => string, curve?: "linear" | "monotone" | "step", area?: boolean, legend?: boolean }: a full chart with axes and a readout',
  BarChart:
    '{ data: Record<string, number | string>[], keys: (string | { key: string, label?: string, tint?: Tint })[], indexBy: string, height?: number = 240, layout?: "vertical" | "horizontal", mode?: "grouped" | "stacked" = "stacked", valueFormat?: (value: number) => string, legend?: boolean }: a full chart with axes and a readout with the total',
  PieChart:
    "{ data: { id: string, value: number, label?: string, tint?: Tint }[], height?: number = 240, donut?: boolean, valueFormat?: (value: number) => string, legend?: boolean }",
  useNivoTheme:
    "(): { theme, colors: string[] }: the kit charts' nivo theme and series colours for the user's theme, to pass to charts imported from `@nivo/*`",
  Button:
    '{ variant?: "solid" | "outline" | "ghost", pill?: boolean, size?: "2xs" | "xs" | "sm" | "md" | "lg" | "xl", tone?: "neutral" | "primary" | "success" | "warning" | "danger", loading?: boolean, disabled?: boolean, onClick, children }',
  Tabs: "Tabs.Root { value?, defaultValue?, onValueChange? } > Tabs.List { children: Tabs.Tab { value, children }[] } + Tabs.Panel { value, children }: segmented tabs, only to compare views of one subject",
  Select:
    "Select { value?, defaultValue?, onValueChange? } > SelectTrigger { children: <SelectValue /> } + SelectContent { children: SelectItem[] }",
  SelectTrigger: "see Select",
  SelectValue: "see Select",
  SelectContent: "see Select",
  SelectItem: "{ value: string, children }",
  ToggleGroup:
    "{ value?: string[], defaultValue?: string[], onValueChange?: (value: string[]) => void, multiple?: boolean, children: Toggle[] }",
  Toggle: "{ value: string, size?: as Button, tone?: as Button, children }",
  Switch:
    "{ label: string, checked?, defaultChecked?, onCheckedChange?: (checked: boolean) => void, disabled? }",
  Checkbox:
    "{ checked?, defaultChecked?, indeterminate?, onCheckedChange?: (checked: boolean) => void, disabled? }",
  Slider:
    "Slider.Root { value?, defaultValue?, onValueChange?, min?, max?, step? } > Slider.Control > Slider.Track > Slider.Indicator + Slider.Thumb",
  Tooltip:
    "Tooltip > TooltipTrigger { render?: ReactElement, children } + TooltipContent { side?, children }",
  TooltipTrigger: "see Tooltip",
  TooltipContent: "see Tooltip",
  Collapsible:
    "Collapsible.Root { open?, defaultOpen?, onOpenChange? } > Collapsible.Trigger { children } + Collapsible.Panel { children }",
  Kbd: "{ keys: string[] }",
  Spinner: "{}",
  useColorScheme: '(): "light" | "dark"',
} as const;

export const KIT_EXPORTS: readonly string[] = Object.keys(KIT);

export const CANVAS_VARIABLES = [
  "--nyte-custom-hue",
  "--nyte-custom-chroma-scale",
  "--nyte-font-family-sans",
  "--nyte-font-family-mono",
  "--nyte-font-size-base",
  "--nyte-font-size-code",
  "--nyte-letter-spacing-lg",
  "--nyte-font-smoothing",
  "--nyte-moz-font-smoothing",
  "--nyte-reduce-transparency",
] as const;

export const CANVAS_PROTOCOL_VERSION = "2026-01-26";

export type CanvasHostContext = {
  readonly theme: "light" | "dark";
  readonly styles: { readonly variables: Readonly<Record<string, string>> };
  readonly displayMode: "inline";
  readonly platform: "desktop" | "web" | "mobile";
  readonly deviceCapabilities: { readonly touch: boolean; readonly hover: boolean };
};

export type CanvasModule = {
  readonly runtime: number;
  readonly code: string;
  readonly title: string;
};

export type CanvasHostInfo = {
  readonly name: "nyte-desktop" | "nyte-web" | "nyte-ios" | "nyte-preview";
  readonly version: string;
};

export type JsonRpcId = string | number;

export type ShellMessage =
  | { readonly kind: "initialize"; readonly id: JsonRpcId; readonly runtime: number }
  | { readonly kind: "initialized" }
  | { readonly kind: "size"; readonly height: number }
  | { readonly kind: "open-link"; readonly id: JsonRpcId; readonly url: string }
  | { readonly kind: "library"; readonly name: CanvasLibrary }
  | {
      readonly kind: "act";
      readonly id: JsonRpcId;
      readonly action: string;
      readonly input: Json;
    }
  | {
      readonly kind: "error";
      readonly phase: "load" | "render";
      readonly message: string;
      readonly stack: string | null;
    };

export type HostMessage =
  | {
      readonly kind: "initialize-result";
      readonly id: JsonRpcId;
      readonly hostInfo: CanvasHostInfo;
      readonly hostContext: CanvasHostContext;
    }
  | { readonly kind: "render"; readonly module: CanvasModule }
  | { readonly kind: "context-changed"; readonly context: Partial<CanvasHostContext> }
  | { readonly kind: "open-link-result"; readonly id: JsonRpcId; readonly isError: boolean }
  | { readonly kind: "library-result"; readonly name: CanvasLibrary; readonly source: string }
  | { readonly kind: "part-state"; readonly state: Json }
  | { readonly kind: "act-result"; readonly id: JsonRpcId; readonly outcome: Json };

const INITIALIZE = "ui/initialize";

const INITIALIZED = "ui/notifications/initialized";

const SIZE_CHANGED = "ui/notifications/size-changed";

const OPEN_LINK = "ui/open-link";

const LIBRARY = "nyte/library";

const LOG_MESSAGE = "notifications/message";

const HOST_CONTEXT_CHANGED = "ui/notifications/host-context-changed";

const RENDER = "nyte/notifications/render";

const PART_STATE = "nyte/notifications/part-state";

const ACT = "nyte/act";

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export function initializeRequest(id: JsonRpcId, runtime: number): Json {
  return {
    jsonrpc: "2.0",
    id,
    method: INITIALIZE,
    params: {
      protocolVersion: CANVAS_PROTOCOL_VERSION,
      appInfo: { name: "nyte-canvas", version: String(runtime) },
      appCapabilities: {},
    },
  };
}

export function initializedNotification(): Json {
  return { jsonrpc: "2.0", method: INITIALIZED, params: {} };
}

export function sizeChangedNotification(height: number): Json {
  return { jsonrpc: "2.0", method: SIZE_CHANGED, params: { height } };
}

export function openLinkRequest(id: JsonRpcId, url: string): Json {
  return { jsonrpc: "2.0", id, method: OPEN_LINK, params: { url } };
}

export function errorNotification(error: {
  readonly phase: "load" | "render";
  readonly message: string;
  readonly stack?: string;
}): Json {
  return {
    jsonrpc: "2.0",
    method: LOG_MESSAGE,
    params: {
      level: "error",
      logger: "nyte-canvas",
      data: {
        phase: error.phase,
        message: error.message,
        ...(error.stack === undefined ? {} : { stack: error.stack }),
      },
    },
  };
}

export function initializeResult(
  id: JsonRpcId,
  hostInfo: CanvasHostInfo,
  hostContext: CanvasHostContext,
): Json {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: CANVAS_PROTOCOL_VERSION,
      hostInfo,
      hostCapabilities: {},
      hostContext: contextJson(hostContext),
    },
  };
}

export function renderNotification(module: CanvasModule): Json {
  return {
    jsonrpc: "2.0",
    method: RENDER,
    params: { runtime: module.runtime, code: module.code, title: module.title },
  };
}

export function partStateNotification(state: Json): Json {
  return { jsonrpc: "2.0", method: PART_STATE, params: { state } };
}

export function actRequest(id: JsonRpcId, action: string, input: Json): Json {
  return { jsonrpc: "2.0", id, method: ACT, params: { action, input } };
}

export function actResult(id: JsonRpcId, outcome: Json): Json {
  return { jsonrpc: "2.0", id, result: { outcome } };
}

export function hostContextChangedNotification(context: Partial<CanvasHostContext>): Json {
  return { jsonrpc: "2.0", method: HOST_CONTEXT_CHANGED, params: contextJson(context) };
}

export function openLinkResult(id: JsonRpcId, isError = false): Json {
  return { jsonrpc: "2.0", id, result: isError ? { isError: true } : {} };
}

export function libraryRequest(name: CanvasLibrary): Json {
  return { jsonrpc: "2.0", id: name, method: LIBRARY, params: { name } };
}

export function libraryResult(name: CanvasLibrary, source: string): Json {
  return { jsonrpc: "2.0", id: name, result: { source } };
}

export function readShellMessage(data: unknown): ShellMessage | undefined {
  const message = envelope(data);

  if (message === undefined) return undefined;
  const { id, method, params } = message;

  if (method === INITIALIZE && id !== undefined) {
    const info = record(params?.["appInfo"]);
    const runtime = info === undefined ? NaN : Number(info["version"]);

    return Number.isInteger(runtime) && runtime > 0
      ? { kind: "initialize", id, runtime }
      : undefined;
  }

  if (method === INITIALIZED) return { kind: "initialized" };

  if (method === SIZE_CHANGED) {
    const height = params?.["height"];

    return typeof height === "number" && Number.isFinite(height) && height > 0
      ? { kind: "size", height }
      : undefined;
  }

  if (method === OPEN_LINK && id !== undefined) {
    const url = linkHref(params?.["url"]);

    return url === undefined ? undefined : { kind: "open-link", id, url };
  }

  if (method === LIBRARY) {
    const name = readCanvasLibrary(params?.["name"]);

    return name !== undefined && id === name ? { kind: "library", name } : undefined;
  }

  if (method === ACT && id !== undefined) {
    const action = params?.["action"];
    const input = readJson(params?.["input"]);

    return typeof action === "string" && action !== "" && input !== undefined
      ? { kind: "act", id, action, input }
      : undefined;
  }

  if (method === LOG_MESSAGE) {
    const payload = record(params?.["data"]);
    const phase = payload?.["phase"];
    const text = payload?.["message"];
    const stack = payload?.["stack"];

    if (
      params?.["level"] !== "error" ||
      (phase !== "load" && phase !== "render") ||
      typeof text !== "string"
    )
      return undefined;

    return { kind: "error", phase, message: text, stack: typeof stack === "string" ? stack : null };
  }

  return undefined;
}

export function readHostMessage(data: unknown): HostMessage | undefined {
  const message = envelope(data);

  if (message === undefined) return undefined;
  const { id, method, params, result } = message;

  if (method === undefined && id !== undefined && result !== undefined) {
    if ("outcome" in result) {
      const outcome = readJson(result["outcome"]);

      return outcome === undefined ? undefined : { kind: "act-result", id, outcome };
    }

    if ("source" in result) {
      const source = result["source"];
      const name = readCanvasLibrary(id);

      return typeof source === "string" && name !== undefined
        ? { kind: "library-result", name, source }
        : undefined;
    }

    if (result["hostContext"] === undefined)
      return { kind: "open-link-result", id, isError: result["isError"] === true };
    const info = record(result["hostInfo"]);
    const context = readContext(result["hostContext"]);
    const name = info?.["name"];
    const version = info?.["version"];

    if (
      context === undefined ||
      typeof version !== "string" ||
      (name !== "nyte-desktop" &&
        name !== "nyte-web" &&
        name !== "nyte-ios" &&
        name !== "nyte-preview")
    )
      return undefined;

    return { kind: "initialize-result", id, hostInfo: { name, version }, hostContext: context };
  }

  if (method === RENDER) {
    const runtime = params?.["runtime"];
    const code = params?.["code"];
    const title = params?.["title"];

    return Number.isInteger(runtime) &&
      typeof runtime === "number" &&
      runtime > 0 &&
      typeof code === "string" &&
      typeof title === "string"
      ? { kind: "render", module: { runtime, code, title } }
      : undefined;
  }

  if (method === HOST_CONTEXT_CHANGED) {
    const context = readPartialContext(params);

    return context === undefined ? undefined : { kind: "context-changed", context };
  }

  if (method === PART_STATE) {
    const state = readJson(params?.["state"]);

    return state === undefined ? undefined : { kind: "part-state", state };
  }

  return undefined;
}

export function clampCanvasHeight(height: number): number {
  return Math.min(CANVAS_MAX_HEIGHT, Math.max(CANVAS_MIN_HEIGHT, Math.round(height)));
}

export type CanvasMeasuredHeight = { readonly width: number; readonly height: number };

export function canvasStartHeight(
  canvas: {
    readonly height: number | null;
    readonly heights?: readonly CanvasMeasuredHeight[];
  },
  width: number | undefined,
): number {
  const fallback = clampCanvasHeight(canvas.height ?? CANVAS_DEFAULT_HEIGHT);

  if (width === undefined || canvas.heights === undefined) return fallback;
  const measured = canvas.heights.toSorted((left, right) => left.width - right.width);
  const narrower = measured.findLast((point) => point.width <= width);
  const wider = measured.find((point) => point.width >= width);

  const height = Math.max(narrower?.height ?? 0, wider?.height ?? 0);

  return height > 0 ? clampCanvasHeight(height) : fallback;
}

export function sanitizeCanvasVariables(
  variables: Readonly<Record<string, string>>,
): Record<string, string> {
  const allowed: readonly string[] = CANVAS_VARIABLES;

  return Object.fromEntries(
    Object.entries(variables)
      .filter(([name]) => allowed.includes(name))
      .map(([name, value]) => [name, value.replace(/[;{}<>]/g, "")]),
  );
}

function contextJson(context: Partial<CanvasHostContext>): Json {
  return {
    ...(context.theme === undefined ? {} : { theme: context.theme }),
    ...(context.styles === undefined ? {} : { styles: { variables: context.styles.variables } }),
    ...(context.displayMode === undefined ? {} : { displayMode: context.displayMode }),
    ...(context.platform === undefined ? {} : { platform: context.platform }),
    ...(context.deviceCapabilities === undefined
      ? {}
      : {
          deviceCapabilities: {
            touch: context.deviceCapabilities.touch,
            hover: context.deviceCapabilities.hover,
          },
        }),
  };
}

function readPartialContext(value: unknown): Partial<CanvasHostContext> | undefined {
  const params = record(value);

  if (params === undefined) return undefined;
  const theme = params["theme"];
  const styles = record(params["styles"]);
  const variables = styles === undefined ? undefined : record(styles["variables"]);
  const platform = params["platform"];
  const capabilities = record(params["deviceCapabilities"]);
  const touch = capabilities?.["touch"];
  const hover = capabilities?.["hover"];

  if (theme !== undefined && theme !== "light" && theme !== "dark") return undefined;

  if (styles !== undefined && variables === undefined) return undefined;

  if (params["displayMode"] !== undefined && params["displayMode"] !== "inline") return undefined;

  if (
    platform !== undefined &&
    platform !== "desktop" &&
    platform !== "web" &&
    platform !== "mobile"
  )
    return undefined;

  if (capabilities !== undefined && (typeof touch !== "boolean" || typeof hover !== "boolean"))
    return undefined;

  return {
    ...(theme === undefined ? {} : { theme }),
    ...(variables === undefined
      ? {}
      : { styles: { variables: sanitizeCanvasVariables(stringEntries(variables)) } }),
    ...(params["displayMode"] === undefined ? {} : { displayMode: "inline" as const }),
    ...(platform === undefined ? {} : { platform }),
    ...(typeof touch !== "boolean" || typeof hover !== "boolean"
      ? {}
      : { deviceCapabilities: { touch, hover } }),
  };
}

function readContext(value: unknown): CanvasHostContext | undefined {
  const partial = readPartialContext(value);

  return partial?.theme !== undefined &&
    partial.styles !== undefined &&
    partial.displayMode !== undefined &&
    partial.platform !== undefined &&
    partial.deviceCapabilities !== undefined
    ? {
        theme: partial.theme,
        styles: partial.styles,
        displayMode: partial.displayMode,
        platform: partial.platform,
        deviceCapabilities: partial.deviceCapabilities,
      }
    : undefined;
}

function envelope(data: unknown):
  | {
      readonly id: JsonRpcId | undefined;
      readonly method: string | undefined;
      readonly params: Record<string, unknown> | undefined;
      readonly result: Record<string, unknown> | undefined;
    }
  | undefined {
  const message = record(data);

  if (message === undefined || message["jsonrpc"] !== "2.0") return undefined;
  const id = message["id"];
  const method = message["method"];

  if (method !== undefined && typeof method !== "string") return undefined;

  return {
    id: typeof id === "string" || typeof id === "number" ? id : undefined,
    method,
    params: record(message["params"]),
    result: record(message["result"]),
  };
}

function readJson(value: unknown): Json | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;

  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;

  if (Array.isArray(value)) {
    const items = value.map(readJson);
    const json = items.filter((item): item is Json => item !== undefined);

    return json.length === items.length ? json : undefined;
  }

  if (typeof value !== "object") return undefined;
  const entries = Object.entries(value).map(([key, item]) => [key, readJson(item)] as const);
  const json = entries.filter((entry): entry is readonly [string, Json] => entry[1] !== undefined);

  return json.length === entries.length ? Object.fromEntries(json) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function stringEntries(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, text]) =>
      typeof text === "string" ? [[name, text]] : [],
    ),
  );
}

function linkHref(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const scheme = /^([a-z][a-z\d+-]*):/iu.exec(value)?.[1]?.toLowerCase();

  if (scheme === undefined) return value;

  if (scheme !== "http" && scheme !== "https") return undefined;

  return URL.parse(value)?.href;
}
