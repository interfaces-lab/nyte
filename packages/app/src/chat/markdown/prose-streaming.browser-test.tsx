import "../../../test/window-bridge.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { Activity } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../../theme/tokens.stylex.ts";
import { Prose } from "./prose.tsx";

const STEPS = [
  { name: "static", markdown: "History.\n\nTail", streaming: false },
  { name: "live", markdown: "History.\n\nTail", streaming: true },
  { name: "inline", markdown: "History.\n\nTail `sum`", streaming: true },
  { name: "append", markdown: "History.\n\nTail `sum` grows.", streaming: true },
  {
    name: "block",
    markdown: "History.\n\nTail `sum` grows.\n\nFresh block.\n\nNext",
    streaming: true,
  },
  {
    name: "reveal",
    markdown: "History.\n\nTail `sum` grows.\n\nFresh block.\n\nNext hidden",
    streaming: true,
    hidden: true,
  },
  {
    name: "resumed",
    markdown: "History.\n\nTail `sum` grows.\n\nFresh block.\n\nNext hidden resumed",
    streaming: true,
  },
  {
    name: "settle",
    markdown: "History.\n\nTail `sum` grows.\n\nFresh block.\n\nNext hidden resumed",
    streaming: false,
  },
];

const painted = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });

export async function run(): Promise<string> {
  applyDisplayMode("light");
  const host = document.createElement("div");
  host.style.width = "640px";
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();
  const seen = new Set<Animation>();
  let longest = 0;

  const draw = (markdown: string, streaming: boolean, visible: boolean): void =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <Activity mode={visible ? "visible" : "hidden"}>
              <Prose markdown={markdown} streaming={streaming} />
            </Activity>
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

  const fresh = (): string[] =>
    host.getAnimations({ subtree: true }).flatMap((animation) => {
      if (
        seen.has(animation) ||
        !(animation instanceof CSSAnimation) ||
        animation.animationName !== "markdown-fade-in"
      ) {
        return [];
      }

      seen.add(animation);
      longest = Math.max(longest, Number(animation.effect?.getComputedTiming().endTime));
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;

      return target?.textContent?.trim().split(/\s+/u) ?? [];
    });

  const paragraphs = (): string[] =>
    [...host.querySelectorAll("p")].map((paragraph) => paragraph.textContent.trim());

  const quiet = async (expected: string): Promise<string[]> => {
    const deadline = performance.now() + 5000;
    const words = fresh();

    while (
      paragraphs().join("\n\n") !== expected ||
      [...seen].some((animation) => animation.playState === "running")
    ) {
      if (performance.now() > deadline) {
        throw new Error(`Timed out at ${JSON.stringify(paragraphs())}`);
      }

      await painted();
      words.push(...fresh());
    }

    return words.toSorted();
  };

  try {
    const fades: Record<string, string[]> = {};

    for (const step of STEPS) {
      if (step.name === "live") flushSync(() => root.render(null));

      if (step.hidden === true) {
        draw(step.markdown, step.streaming, false);
        await painted();
      }

      draw(step.markdown, step.streaming, true);
      fades[step.name] = await quiet(step.markdown.replaceAll("`", ""));
    }

    return JSON.stringify({
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      longest,
      fades,
    });
  } finally {
    root.unmount();
    host.remove();
  }
}
