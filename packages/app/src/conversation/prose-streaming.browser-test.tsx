import "./transcript-render-counter.ts";
import "../../test/window-bridge.ts";
import { Block } from "streamdown";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../theme/tokens.stylex.ts";
import { renderCount, resetRenders } from "./transcript-render-counter.ts";
import { Prose } from "./prose.tsx";

const PARAGRAPHS = 10;

const ANSWER = Array.from(
  { length: PARAGRAPHS },
  (_, paragraph) =>
    `Paragraph ${String(paragraph)} explains how the \`sum\` helper adds two **numbers** and why the transcript keeps every finished block still while the tail grows word by word until the answer ends.`,
).join("\n\n");

const WORDS = ANSWER.split(/(?<=\s)(?=\S)/u);

const painted = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function renders(): number {
  const counts = renderCount(Block);

  return counts.mounts + counts.updates;
}

export async function run(): Promise<string> {
  applyDisplayMode("light");
  const host = document.createElement("div");
  host.style.width = "640px";
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();

  const draw = (markdown: string, streaming = true): void =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <Prose markdown={markdown} streaming={streaming} />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

  try {
    resetRenders(Block);
    let markdown = "";
    let fadeSpans = 0;

    for (const word of WORDS) {
      markdown += word;
      draw(markdown);
      await painted();
      fadeSpans = Math.max(fadeSpans, host.querySelectorAll("[data-sd-animate]").length);
    }

    const pushedAt = performance.now();
    const deadline = pushedAt + 10_000;

    while (host.textContent?.endsWith("answer ends.") !== true && performance.now() < deadline)
      await painted();

    const revealMs = performance.now() - pushedAt;

    const streamed = renders();
    await sleep(1_000);
    const settling = renders() - streamed;
    const settled = renders();
    await sleep(1_000);
    const idle = renders() - settled;
    draw(ANSWER, false);
    await painted();
    const paragraphs = [...host.querySelectorAll("p")];

    return JSON.stringify({
      deltas: WORDS.length,
      revealMs,
      blocks: paragraphs.length,
      markdownRenders: streamed,
      rendersPerDelta: streamed / WORDS.length,
      settlingRenders: settling,
      idleRenders: idle,
      fadeSpans,
      unsettledSpans: host.querySelectorAll("[data-sd-animate]").length,
    });
  } finally {
    root.unmount();
    host.remove();
  }
}
