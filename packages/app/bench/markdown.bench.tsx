import type { Static } from "typebox";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Streamdown } from "streamdown";
import { Prose } from "../src/chat/markdown/prose.tsx";
import { MarkdownCase } from "./gates.ts";
import type { MarkdownResult } from "./gates.ts";
import { FIXTURES, measure, nextFrame, Page, readCase, STEP_CHARS } from "./page.tsx";
import { quantile, sum } from "./stats.ts";

const SETTLE_MS = 300;

export async function run(): Promise<string> {
  const variant = readCase(MarkdownCase).variant;
  const host = document.createElement("div");
  host.style.width = "640px";
  document.body.append(host);
  const root = createRoot(host);

  const draw = (markdown: string | undefined, streaming: boolean): void =>
    flushSync(() =>
      root.render(
        <Page>
          {markdown === undefined ? null : variant === "prose" ? (
            <Prose markdown={markdown} streaming={streaming} />
          ) : (
            <Streamdown isAnimating={streaming} skipHtml controls={false} lineNumbers={false}>
              {markdown}
            </Streamdown>
          )}
        </Page>,
      ),
    );

  const replay = async (markdown: string) => {
    draw(undefined, false);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    await nextFrame();
    const scripts: number[] = [];
    const layouts: number[] = [];

    for (let at = STEP_CHARS; at < markdown.length + STEP_CHARS; at += STEP_CHARS) {
      const streaming = at < markdown.length;
      const started = performance.now();
      draw(streaming ? markdown.slice(0, at) : markdown, streaming);
      const rendered = performance.now();
      void host.offsetHeight;
      scripts.push(rendered - started);
      layouts.push(performance.now() - rendered);
    }

    return {
      totalMs: sum(scripts) + sum(layouts),
      scriptMs: sum(scripts),
      layoutMs: sum(layouts),
      p95Ms: quantile(
        scripts.map((script, index) => script + (layouts[index] ?? 0)),
        0.95,
      ),
      elements: host.querySelectorAll("*").length,
    };
  };

  const result: Static<typeof MarkdownResult> = [];

  for (const fixture of FIXTURES) {
    const runs = await measure(() => replay(fixture.markdown));
    result.push({
      fixture: fixture.name,
      updates: Math.ceil(fixture.markdown.length / STEP_CHARS),
      runs,
    });
  }

  root.unmount();
  host.remove();

  return JSON.stringify(result);
}
