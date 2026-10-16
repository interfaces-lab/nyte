/**
 * The inline canvas contract every side shares, with no dependencies: the
 * runtime version, the two import surfaces a canvas module may use, the
 * size caps, and the JSON-RPC messages between a client and the runtime
 * shell, in the MCP Apps shape (`ui/*` methods as upstream defines them,
 * `nyte/*` for the one extension). Builders make a message; readers narrow
 * `unknown` data from a `message` event into a typed one or `undefined`.
 */

/** The kit surface a compiled module was built against. Bump on any change to `KIT` or a kit component's props; a shell renders a canvas whose runtime is at most its own. */
export const CANVAS_RUNTIME = 1;

/** The global the shell installs before importing a module: `{ runtime, react, jsxRuntime, kit }`. */
export const CANVAS_GLOBAL = "__nyteCanvas";

/** The import specifier for the kit. */
export const KIT_SPECIFIER = "nyte/canvas";

/** Bytes of TSX the tool accepts. */
export const CANVAS_SOURCE_LIMIT = 65_536;

/** Bytes of compiled module a part may hold. */
export const CANVAS_CODE_LIMIT = 196_608;

/** The frame's height range in CSS pixels; a taller canvas scrolls inside. */
export const CANVAS_MIN_HEIGHT = 48;

export const CANVAS_MAX_HEIGHT = 2000;

/** The height hint range the tool accepts. */
export const CANVAS_MIN_HEIGHT_HINT = 80;

/** The frame height before a canvas reports its own, when the agent gave no hint. */
export const CANVAS_DEFAULT_HEIGHT = 80;

/** React 19's public surface a canvas may import, without `act`, `version` and the unstable or server-only names. */
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

/** The hues a series, a sparkline or a meter may name; charts without one take them in this order. */
export const TINTS = [
  "blue",
  "purple",
  "teal",
  "orange",
  "green",
  "pink",
  "yellow",
  "red",
  "gray",
  "brown",
] as const;

/**
 * The kit, name by name, each with the one-line signature the model reads.
 * `packages/canvas` exports exactly these names, in a test; the compiler
 * answers any other import of `nyte/canvas` with a positioned error.
 */
export const KIT = {
  Stack:
    '{ direction?: "row" | "column" = "column", gap?: 0 | 1 | 2 | 3 | 4 | 6 = 2 (×4 px), align?: "start" | "center" | "end" | "stretch", justify?: "start" | "center" | "end" | "between", wrap?: boolean, children }: flex layout',
  Grid: '{ columns?: number | "auto" = "auto", minWidth?: number = 160 (px, with "auto"), gap?: 0 | 1 | 2 | 3 | 4 | 6 = 2, children }: equal columns',
  Divider: "{}: a hairline",
  Heading: "{ level?: 1 | 2 | 3 = 2, children }",
  Text: '{ size?: "xs" | "sm" | "base" | "lg", tone?: "primary" | "secondary" | "tertiary", weight?: "normal" | "medium" | "semibold", mono?: boolean, truncate?: boolean, align?: "start" | "center" | "end", children }',
  Code: "{ block?: boolean, children: string }: monospace, inline or a block",
  Stat: '{ label: string, value: ReactNode, detail?: ReactNode, tone?: "neutral" | "success" | "warning" | "danger" }: a labelled number',
  Badge: '{ tone?: "neutral" | "info" | "success" | "warning" | "danger", children }',
  Meter:
    '{ value: number, max?: number = 100, label?: string, tone?: "primary" | "success" | "warning" | "danger" = "primary" }: a thin filled bar with the value beside the label',
  Table:
    '{ columns: { key: string, label: ReactNode, align?: "start" | "end", width?: number | string }[], rows: Record<string, ReactNode>[], caption?: string }: rows are keyed by column key; a cell can hold a Sparkline or a Badge',
  Callout: '{ tone?: "info" | "success" | "warning" | "danger", title?: string, children }',
  Card: "{ title?: ReactNode, actions?: ReactNode, padding?: 0 | 2 | 3 | 4 = 4, children }: an elevated bordered surface",
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
  Button:
    '{ variant?: "solid" | "outline" | "ghost" | "pill" | "chip", size?: "2xs" | "xs" | "sm" | "md" | "lg" | "xl", tone?: "neutral" | "primary" | "success" | "warning" | "danger", loading?: boolean, disabled?: boolean, onClick, children }',
  Tabs: "Tabs.Root { value?, defaultValue?, onValueChange? } > Tabs.List { children: Tabs.Tab { value, children }[] } + Tabs.Panel { value, children }",
  Select:
    "Select { value?, defaultValue?, onValueChange? } > SelectTrigger { children: <SelectValue /> } + SelectContent { children: SelectItem[] }",
  SelectTrigger: "see Select",
  SelectValue: "see Select",
  SelectContent: "see Select",
  SelectItem: "{ value: string, children }",
  ToggleGroup:
    "{ value?: string[], defaultValue?: string[], onValueChange?: (value: string[]) => void, toggleMultiple?: boolean, children: Toggle[] }",
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

/** Every name `nyte/canvas` exports, in `KIT` order. */
export const KIT_EXPORTS: readonly string[] = Object.keys(KIT);

/** The custom properties a client may hand the shell; anything else is dropped. */
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

/** What a client tells the shell about where it runs. */
export type CanvasHostContext = {
  readonly theme: "light" | "dark";
  readonly styles: { readonly variables: Readonly<Record<string, string>> };
  readonly displayMode: "inline";
  readonly platform: "desktop" | "web" | "mobile";
  readonly deviceCapabilities: { readonly touch: boolean; readonly hover: boolean };
};

/** A compiled canvas, as the part holds it and the shell receives it. */
export type CanvasModule = {
  readonly runtime: number;
  readonly code: string;
  readonly title: string;
};

/** Who answers `ui/initialize`. */
export type CanvasHostInfo = {
  readonly name: "nyte-desktop" | "nyte-web" | "nyte-ios";
  readonly version: string;
};

export type JsonRpcId = string | number;

/** A message the shell sends its client. */
export type ShellMessage =
  | { readonly kind: "initialize"; readonly id: JsonRpcId; readonly runtime: number }
  | { readonly kind: "initialized" }
  | { readonly kind: "size"; readonly height: number }
  /** `url` is an http(s) URL, or a reference with no scheme that the client resolves in its workspace. */
  | { readonly kind: "open-link"; readonly id: JsonRpcId; readonly url: string }
  | {
      readonly kind: "error";
      readonly phase: "load" | "render";
      readonly message: string;
      readonly stack: string | null;
    };

/** A message a client sends the shell. */
export type HostMessage =
  | {
      readonly kind: "initialize-result";
      readonly id: JsonRpcId;
      readonly hostInfo: CanvasHostInfo;
      readonly hostContext: CanvasHostContext;
    }
  | { readonly kind: "render"; readonly module: CanvasModule }
  | { readonly kind: "context-changed"; readonly context: Partial<CanvasHostContext> }
  | { readonly kind: "open-link-result"; readonly id: JsonRpcId; readonly isError: boolean };

const INITIALIZE = "ui/initialize";

const INITIALIZED = "ui/notifications/initialized";

const SIZE_CHANGED = "ui/notifications/size-changed";

const OPEN_LINK = "ui/open-link";

const LOG_MESSAGE = "notifications/message";

const HOST_CONTEXT_CHANGED = "ui/notifications/host-context-changed";

const RENDER = "nyte/notifications/render";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** Returns the `ui/initialize` request the shell opens with. */
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

/** Returns the error notification the shell sends when a module fails to load or render. */
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

/** Returns the answer to the shell's `ui/initialize`. */
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

export function hostContextChangedNotification(context: Partial<CanvasHostContext>): Json {
  return { jsonrpc: "2.0", method: HOST_CONTEXT_CHANGED, params: contextJson(context) };
}

export function openLinkResult(id: JsonRpcId, isError = false): Json {
  return { jsonrpc: "2.0", id, result: isError ? { isError: true } : {} };
}

/** Returns the message a shell posted, or undefined for anything that is not one. */
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

/** Returns the message a client posted into the shell, or undefined for anything that is not one. */
export function readHostMessage(data: unknown): HostMessage | undefined {
  const message = envelope(data);

  if (message === undefined) return undefined;
  const { id, method, params, result } = message;

  if (method === undefined && id !== undefined && result !== undefined) {
    if (result["hostContext"] === undefined)
      return { kind: "open-link-result", id, isError: result["isError"] === true };
    const info = record(result["hostInfo"]);
    const context = readContext(result["hostContext"]);
    const name = info?.["name"];
    const version = info?.["version"];

    if (
      context === undefined ||
      typeof version !== "string" ||
      (name !== "nyte-desktop" && name !== "nyte-web" && name !== "nyte-ios")
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

  return undefined;
}

/** Returns the height a frame shows a canvas at, within the range. */
export function clampCanvasHeight(height: number): number {
  return Math.min(CANVAS_MAX_HEIGHT, Math.max(CANVAS_MIN_HEIGHT, Math.round(height)));
}

/** Returns the variables the shell may apply: allowlisted names, values stripped of the characters that could end a declaration. */
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

/**
 * A link a canvas may ask its client to open: an http(s) URL, or a reference
 * with no scheme, such as `src/ci.ts:42`, which the client resolves in its
 * workspace or refuses. Every other scheme (`javascript:`, `file:`) is refused.
 */
function linkHref(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const scheme = /^([a-z][a-z\d+-]*):/iu.exec(value)?.[1]?.toLowerCase();

  if (scheme === undefined) return value;

  if (scheme !== "http" && scheme !== "https") return undefined;

  return URL.parse(value)?.href;
}
