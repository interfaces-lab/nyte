import "../../test/window-bridge.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import type { CanvasState } from "@nyte-ai/plugin/canvas/schema";
import { preferences } from "../preferences/index.ts";
import "../theme/tokens.stylex.ts";
import { CanvasFrame } from "./canvas-frame.tsx";

declare global {
  interface Window {
    readonly canvases: Readonly<
      Record<string, { readonly runtime: number; readonly code: string }>
    >;
  }
}

async function until(predicate: () => boolean, what: () => string): Promise<void> {
  const deadline = performance.now() + 20_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(what());
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

export async function run(): Promise<string> {
  applyDisplayMode("dark");
  preferences.theme.set("dark");
  const host = document.createElement("div");
  host.style.width = "808px";
  document.body.append(host);
  const root = createRoot(host);
  const reported: string[] = [];

  const state = (name: string, title: string): CanvasState => {
    const compiled = window.canvases[name];

    if (compiled === undefined) throw new Error(`No canvas ${name}.`);

    return { ...compiled, title, height: 240, error: null };
  };

  flushSync(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <CanvasFrame
          state={state("galaxy", "Repo galaxy")}
          report={(message) => reported.push(message)}
        />
        <CanvasFrame
          state={state("broken", "Broken rows")}
          report={(message) => reported.push(message)}
        />
      </QueryClientProvider>,
    ),
  );

  const boxes = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>("figure > div")];

  const caption = (): string | undefined =>
    host.querySelector("figcaption")?.textContent ?? undefined;

  try {
    await until(
      () => (boxes()[0]?.getBoundingClientRect().height ?? 0) > 600,
      () =>
        `The galaxy did not settle: ${JSON.stringify(boxes().map((box) => box.getBoundingClientRect().height))}, reported ${JSON.stringify(reported)}`,
    );
    await until(
      () => reported.length > 0,
      () => "The broken canvas reported nothing",
    );

    if (!/^TypeError: .* \(main\.tsx:5\)$/u.test(reported.join("\n")))
      return `Reported ${JSON.stringify(reported)}`;

    if (caption() !== reported[0]) return `The caption shows ${JSON.stringify(caption())}`;

    if (host.querySelectorAll("figcaption").length !== 1) return "The galaxy shows an error";

    return "passed";
  } finally {
    root.unmount();
    host.remove();
    preferences.theme.set("system");
  }
}
