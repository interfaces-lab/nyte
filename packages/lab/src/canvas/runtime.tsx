import React, { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { Value } from "typebox/value";
import { HostMessageSchema } from "./messages";
import { BarChart, LineChart, PieChart } from "./sdk";

const sdk = { BarChart, LineChart, PieChart };

const jsxRuntime = { jsx, jsxs, Fragment };

declare global {
  interface Window {
    NyteCanvas: { React: typeof React; jsxRuntime: typeof jsxRuntime; sdk: typeof sdk };
    NyteCanvasModule?: { default?: React.ComponentType };
  }
}

window.NyteCanvas = { React, jsxRuntime, sdk };

const report = (message: string): void =>
  parent.postMessage({ kind: "canvas:error", message }, "*");

class Boundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    report(error.message);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const canvasComponent = () => window.NyteCanvasModule?.default;

const container = document.getElementById("canvas-root");

if (container !== null) {
  const root = createRoot(container);
  window.addEventListener("error", (event) => report(event.message));
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    report(reason instanceof Error ? reason.message : String(reason));
  });
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== parent || !Value.Check(HostMessageSchema, event.data)) return;

    const data = event.data;

    if (data.kind === "canvas:hello") {
      parent.postMessage({ kind: "canvas:ready" }, "*");

      return;
    }

    for (const [key, value] of Object.entries(data.theme.variables))
      document.documentElement.style.setProperty(key, value);

    document.documentElement.style.colorScheme = data.theme.scheme;

    if (data.code === undefined) return;

    try {
      window.NyteCanvasModule = undefined;
      const script = document.createElement("script");
      script.textContent = data.code;
      document.body.append(script);
      script.remove();
      const Canvas = canvasComponent();

      if (Canvas === undefined) throw new Error("Export a React component as default.");
      root.render(
        <Boundary key={data.code}>
          <Canvas />
        </Boundary>,
      );
    } catch (cause) {
      report(cause instanceof Error ? cause.message : String(cause));
    }
  });
  new ResizeObserver(() =>
    parent.postMessage(
      { kind: "canvas:height", height: container.getBoundingClientRect().height },
      "*",
    ),
  ).observe(container);
  parent.postMessage({ kind: "canvas:ready" }, "*");
}
