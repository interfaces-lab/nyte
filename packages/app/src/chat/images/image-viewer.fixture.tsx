import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { platformColors } from "@nyte-ai/ui/platform-colors";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import "../../theme/tokens.stylex.ts";
import "../../theme/global.css";
import { publishDeferred } from "../../lib/deferred.tsx";
import { ImageViewer } from "./image-viewer.tsx";
import { imageViewerRuntime } from "./image-viewer.deferred.tsx";

export function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await paint();
  }
}

export async function paint(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

export async function capture(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    document.addEventListener("renderer-captured", () => resolve(), { once: true });
    window.rendererCapture(name);
  });
}

export async function openViewer(name: string, children?: ReactNode) {
  applyDisplayMode("light");
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("Missing native Canvas context");
  context.fillStyle = platformColors.light.bgBase;
  context.fillRect(0, 0, 64, 64);
  const src = canvas.toDataURL("image/png");
  const container = document.createElement("div");
  container.style.cssText = "width:640px;height:480px;display:flex;flex-direction:column";
  document.body.append(container);
  const root = createRoot(container);
  let source: HTMLImageElement | undefined;
  let signal: AbortSignal | undefined;
  let mounted = true;
  publishDeferred("images", {
    ImageViewerPopup(input) {
      source = input.source;
      signal = input.signal;

      return <imageViewerRuntime.ImageViewerPopup {...input} />;
    },
  });
  flushSync(() =>
    root.render(
      <TooltipProvider>
        <ImageViewer src={src} name={name}>
          <img src={src} alt={name} width={160} height={160} />
        </ImageViewer>
        {children}
      </TooltipProvider>,
    ),
  );
  const trigger = container.querySelector("button");

  if (trigger === null) throw new Error("Missing image trigger");
  flushSync(() => trigger.click());
  await until(() => source !== undefined && signal !== undefined, "the real deferred viewer body");

  const markup = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Markup",
  );

  if (markup === undefined) throw new Error("Missing Markup control");
  flushSync(() => markup.click());
  const box = document.querySelector<HTMLButtonElement>('button[aria-label="Box"]');

  if (box === null) throw new Error("Missing Box control");
  flushSync(() => box.click());
  const drawing = document.querySelector('[role="application"][aria-label="Image markup"]');

  if (drawing === null) throw new Error("Missing drawing control");

  for (const key of ["Enter", "ArrowRight", "ArrowDown", "Enter"])
    flushSync(() =>
      drawing.dispatchEvent(
        new KeyboardEvent("keydown", { key, shiftKey: true, bubbles: true, cancelable: true }),
      ),
    );

  check(
    document.querySelectorAll('[data-image-mark="box"]').length === 1,
    "The viewer must own one completed box",
  );

  const add = Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Add to Chat"),
  );

  if (add === undefined || source === undefined || signal === undefined)
    throw new Error("The viewer did not expose its existing export controls");

  return {
    source,
    signal,
    add,
    unmount() {
      if (!mounted) return;
      mounted = false;
      flushSync(() => root.unmount());
      container.remove();
      publishDeferred("images", imageViewerRuntime);
    },
  };
}
