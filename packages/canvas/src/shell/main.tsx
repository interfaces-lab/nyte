import "./shell.css";
import "@nyte-ai/ui/styles/tokens.stylex";
import React, { Component, StrictMode } from "react";
import type { ComponentType, ErrorInfo, ReactElement, ReactNode } from "react";
import jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { create, props } from "@stylexjs/stylex";
import { applyDisplayMode, applyTint } from "@nyte-ai/ui/appearance";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import {
  CANVAS_GLOBAL,
  CANVAS_RUNTIME,
  errorNotification,
  initializeRequest,
  initializedNotification,
  openLinkRequest,
  readHostMessage,
  sizeChangedNotification,
} from "@nyte-ai/plugin/canvas/protocol";
import type { CanvasHostContext, CanvasModule } from "@nyte-ai/plugin/canvas/protocol";
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
    gap: 4,
    padding: "10px 12px",
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

Object.defineProperty(globalThis, CANVAS_GLOBAL, {
  value: { runtime: CANVAS_RUNTIME, react: React, jsxRuntime, kit },
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

function fail(failure: Failure, stack?: string): void {
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

function isComponent(value: unknown): value is ComponentType {
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
  moduleUrl = URL.createObjectURL(new Blob([module.code], { type: "text/javascript" }));

  try {
    const imported: unknown = await import(/* @vite-ignore */ moduleUrl);
    const Canvas =
      typeof imported === "object" && imported !== null && "default" in imported
        ? imported.default
        : undefined;

    if (!isComponent(Canvas)) {
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
  const chroma = context.styles.variables["--nyte-custom-chroma-scale"];

  if (chroma !== undefined) applyTint(Number(chroma) > 0);
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
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

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

new ResizeObserver(measure).observe(container);

paint();
post(initializeRequest(1, CANVAS_RUNTIME));
