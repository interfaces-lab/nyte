import "./shell.css";
import "@nyte-ai/ui/styles/tokens.stylex";
import React, { Component, StrictMode } from "react";
import type { ComponentType, ErrorInfo, ReactElement, ReactNode } from "react";
import jsxRuntime from "react/jsx-runtime";
import { createPortal, flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { create, props } from "@stylexjs/stylex";
import { applyDisplayMode, applyTint } from "@nyte-ai/ui/appearance";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import {
  CANVAS_GLOBAL,
  CANVAS_RUNTIME,
  CANVAS_STARTUP_CONTEXT,
  errorNotification,
  initializeRequest,
  initializedNotification,
  libraryRequest,
  locateCanvasStack,
  openLinkRequest,
  readCanvasLibrary,
  readHostMessage,
  sizeChangedNotification,
} from "@nyte-ai/plugin/canvas/protocol";
import type {
  CanvasHostContext,
  CanvasLibrary,
  CanvasModule,
} from "@nyte-ai/plugin/canvas/protocol";
import { kit } from "../kit/index.ts";
import { SchemeContext } from "../kit/scheme.ts";

type Failure = { readonly phase: "load" | "render"; readonly message: string };

type Loaded = { readonly title: string; readonly Canvas: ComponentType };

type State = {
  readonly scheme: "light" | "dark";
  readonly loaded: Loaded | null;
  readonly failure: Failure | null;
};

const styles = create({
  failure: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    paddingBlock: space.s2_5,
    paddingInline: space.s3,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderPrimary,
    backgroundColor: role.bgMuted,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  failureDetail: {
    margin: 0,
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: type.leadingCode,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});

/** Each library a canvas imported, and, in a shell with no base URL, the hand-off for the source its client sends. */
const libraries = new Map<
  CanvasLibrary,
  { readonly module: Promise<unknown>; readonly receive: (source: string) => void }
>();

/**
 * Loads one of the libraries, each its own chunk beside the shell, so only a
 * canvas that imports `three` downloads it. A shell with no base URL (the
 * inline one in a WebView) asks its client for the module's source instead.
 * Every import of a library shares one module, so its classes stay one.
 */
function library(specifier: string): Promise<unknown> {
  const name = readCanvasLibrary(specifier);

  if (name === undefined)
    return Promise.reject(new Error(`"${specifier}" is not a canvas library.`));
  const loaded = libraries.get(name);

  if (loaded !== undefined) return loaded.module;
  const url = URL.parse(`libraries/${name}.js`, document.baseURI);
  const source = Promise.withResolvers<string>();

  const module =
    url === null
      ? source.promise.then(
          (code) =>
            import(
              /* @vite-ignore */ URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
            ),
        )
      : import(/* @vite-ignore */ url.href);

  libraries.set(name, { module, receive: source.resolve });

  if (url === null) post(libraryRequest(name));

  return module;
}

Object.defineProperty(globalThis, CANVAS_GLOBAL, {
  value: {
    runtime: CANVAS_RUNTIME,
    react: React,
    jsxRuntime,
    reactDom: { createPortal, flushSync },
    kit,
    library,
  },
  writable: false,
  configurable: false,
});

const container =
  document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));

const root = createRoot(container);

let state: State = { scheme: "light", loaded: null, failure: null };

let reportedHeight = 0;

let links = 0;

let moduleUrl: string | null = null;

let moduleCode = "";

function post(message: unknown): void {
  const bridge = "ReactNativeWebView" in window ? window.ReactNativeWebView : undefined;

  if (
    typeof bridge === "object" &&
    bridge !== null &&
    "postMessage" in bridge &&
    typeof bridge.postMessage === "function"
  ) {
    bridge.postMessage(JSON.stringify(message));

    return;
  }

  window.parent.postMessage(message, "*");
}

/** Shows a failure and reports it, its message ending in the canvas file and line the stack points at. */
function fail(cause: Failure, stack?: string): void {
  const where = stack === undefined ? undefined : locateCanvasStack(moduleCode, stack);
  const failure =
    where === undefined ? cause : { ...cause, message: `${cause.message} (${where})` };
  state = { ...state, failure };
  paint();
  post(
    errorNotification({
      phase: failure.phase,
      message: failure.message,
      ...(stack === undefined ? {} : { stack }),
    }),
  );
}

function describe(error: unknown): { readonly message: string; readonly stack?: string } {
  if (error instanceof Error)
    return {
      message: `${error.name}: ${error.message}`,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };

  return { message: String(error) };
}

class Boundary extends Component<
  { readonly children: ReactNode; readonly onError: (error: unknown, info: ErrorInfo) => void },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError(error, info);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function FailureNote({ failure }: { readonly failure: Failure }): ReactElement {
  return (
    <div role="alert" {...props(styles.failure)}>
      <span>
        {failure.phase === "load"
          ? "This canvas could not be loaded."
          : "This canvas failed while rendering."}
      </span>
      <pre {...props(styles.failureDetail)}>{failure.message}</pre>
    </div>
  );
}

function Shell({ scheme, loaded, failure }: State): ReactElement {
  return (
    <StrictMode>
      <SchemeContext.Provider value={scheme}>
        <TooltipProvider>
          {failure !== null ? <FailureNote failure={failure} /> : null}
          {loaded !== null && failure === null ? (
            <Boundary
              onError={(error, info) => {
                const described = describe(error);
                fail(
                  { phase: "render", message: described.message },
                  described.stack ?? info.componentStack ?? undefined,
                );
              }}
            >
              <loaded.Canvas />
            </Boundary>
          ) : null}
        </TooltipProvider>
      </SchemeContext.Provider>
    </StrictMode>
  );
}

function paint(): void {
  root.render(<Shell {...state} />);
}

// oxlint-disable-next-line nyte-code/no-one-off-boolean-helpers -- typeof narrows an imported default export only to Function, not ComponentType
function exportsComponent(value: unknown): value is ComponentType {
  return typeof value === "function";
}

async function load(module: CanvasModule): Promise<void> {
  if (module.runtime > CANVAS_RUNTIME) {
    fail({
      phase: "load",
      message: `This canvas needs a newer Nyte: it was built for runtime ${String(module.runtime)}, and this one is ${String(CANVAS_RUNTIME)}.`,
    });

    return;
  }

  if (moduleUrl !== null) URL.revokeObjectURL(moduleUrl);
  moduleCode = module.code;
  moduleUrl = URL.createObjectURL(new Blob([module.code], { type: "text/javascript" }));

  try {
    const imported: unknown = await import(/* @vite-ignore */ moduleUrl);
    const Canvas =
      typeof imported === "object" && imported !== null && "default" in imported
        ? imported.default
        : undefined;

    if (!exportsComponent(Canvas)) {
      fail({ phase: "load", message: "The module's default export is not a component." });

      return;
    }

    state = { ...state, loaded: { title: module.title, Canvas }, failure: null };
    paint();
  } catch (error) {
    const described = describe(error);
    fail({ phase: "load", message: described.message }, described.stack);
  }
}

function apply(context: Partial<CanvasHostContext>): void {
  if (context.theme !== undefined) {
    applyDisplayMode(context.theme);
    state = { ...state, scheme: context.theme };
    paint();
  }

  if (context.styles === undefined) return;

  for (const [name, value] of Object.entries(context.styles.variables))
    document.documentElement.style.setProperty(name, value);

  if (context.styles.variables["--nyte-custom-chroma-scale"] !== undefined) applyTint();
}

function receive(data: unknown): void {
  const message = readHostMessage(typeof data === "string" ? parse(data) : data);

  if (message === undefined) return;

  switch (message.kind) {
    case "initialize-result":
      apply(message.hostContext);
      post(initializedNotification());

      return;
    case "render":
      void load(message.module);

      return;
    case "context-changed":
      apply(message.context);

      return;
    case "open-link-result":
      return;
    case "library-result":
      libraries.get(message.name)?.receive(message.source);

      return;
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Reports the root's height. It's observed by its border box, which counts a
 * sideways scrollbar that appears while the content box keeps its size.
 */
function measure(): void {
  const height = Math.ceil(container.getBoundingClientRect().height);

  if (height === reportedHeight || height <= 0) return;
  reportedHeight = height;
  post(sizeChangedNotification(height));
}

window.addEventListener("message", (event) => receive(event.data));

window.addEventListener("error", (event) => {
  event.preventDefault();
  const described = describe(event.error ?? event.message);
  fail({ phase: "render", message: described.message }, described.stack);
});

window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  const described = describe(event.reason);
  fail({ phase: "render", message: described.message }, described.stack);
});

document.addEventListener(
  "click",
  (event) => {
    const anchor = event.composedPath().find((target) => target instanceof HTMLAnchorElement);

    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = anchor.getAttribute("href");

    if (href === null || href.startsWith("#")) return;
    event.preventDefault();

    if (!event.isTrusted) return;
    links += 1;
    post(openLinkRequest(`link-${String(links)}`, href));
  },
  true,
);

new ResizeObserver(measure).observe(container, { box: "border-box" });

const startup = readHostMessage(
  CANVAS_STARTUP_CONTEXT in window ? window[CANVAS_STARTUP_CONTEXT] : undefined,
);

if (startup?.kind === "context-changed") apply(startup.context);

paint();
post(initializeRequest(1, CANVAS_RUNTIME));
