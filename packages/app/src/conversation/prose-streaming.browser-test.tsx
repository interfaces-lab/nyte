import "./transcript-render-counter.ts";
import "../../test/window-bridge.ts";
import { Block } from "streamdown";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { Activity } from "react";
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

const LEAD = "The first paragraph was on screen before the burst.";

const BURST = Array.from(
  { length: 6 },
  (_, sentence) =>
    `Sentence ${String(sentence)} lands inside one large network burst, and the pacer spreads it over a few frames.`,
).join(" ");

const PACED = "Then a few more words are paced in before the chat goes away.";

const WHILE_HIDDEN = "These words arrive while another chat is open.";

const AFTER_RESUME = "Fresh words arrive after the switch back.";

const AFTER_SETTLED_RESUME = "More words follow a second switch.";

const painted = (): Promise<number> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(() => resolve(performance.now()), 0));
  });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function renders(): number {
  const counts = renderCount(Block);

  return counts.mounts + counts.updates;
}

function fading(host: HTMLElement): Element[] {
  return host
    .getAnimations({ subtree: true })
    .filter((animation) => animation.playState === "running" || animation.pending)
    .flatMap((animation) =>
      animation.effect instanceof KeyframeEffect && animation.effect.target !== null
        ? [animation.effect.target]
        : [],
    );
}

function chunkSpans(root: Element): number {
  return [...root.querySelectorAll("span")].filter(
    (span) => getComputedStyle(span).animationName !== "none",
  ).length;
}

function textBefore(host: HTMLElement, node: Node): number {
  const range = document.createRange();
  range.setStart(host, 0);
  range.setEndBefore(node);

  return range.toString().length;
}

function paragraphText(host: HTMLElement): string {
  return [...host.querySelectorAll("p")].map((paragraph) => paragraph.textContent).join("\n");
}

function watch(host: HTMLElement) {
  const started = new Map<Element, number>();
  const ended = new Set<Element>();
  let previous = host.textContent;
  let staleFades = 0;
  let replays = 0;
  let spansMax = 0;
  let fadingMax = 0;
  let oldestFadeMs = 0;
  let emptyChips = 0;
  let chipFades = 0;

  return {
    observe(): string {
      const now = performance.now();
      const text = host.textContent;
      const targets = fading(host);

      for (const target of targets) {
        if (ended.has(target)) replays += 1;
        oldestFadeMs = Math.max(oldestFadeMs, now - (started.get(target) ?? now));

        if (started.has(target)) continue;
        started.set(target, now);

        if (textBefore(host, target) < previous.length) staleFades += 1;
      }

      for (const target of started.keys()) if (!targets.includes(target)) ended.add(target);

      for (const code of host.querySelectorAll("code")) {
        if (targets.some((target) => target !== code && code.contains(target))) emptyChips += 1;

        if (targets.some((target) => target.contains(code))) chipFades += 1;
      }

      spansMax = Math.max(spansMax, chunkSpans(host));
      fadingMax = Math.max(fadingMax, targets.length);
      previous = text;

      return paragraphText(host);
    },
    report: () => ({
      staleFades,
      replays,
      spansMax,
      fadingMax,
      oldestFadeMs,
      emptyChips,
      chipFades,
    }),
  };
}

export async function run(): Promise<string> {
  applyDisplayMode("light");
  const host = document.createElement("div");
  host.style.width = "640px";
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();

  const draw = (markdown: string, streaming: boolean, mode: "visible" | "hidden" = "visible") =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <Activity mode={mode}>
              {markdown === "" ? null : <Prose markdown={markdown} streaming={streaming} />}
            </Activity>
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

  try {
    draw(ANSWER, false);
    await painted();
    const final = paragraphText(host);
    const blocks = host.querySelectorAll("p").length;
    draw("", false);

    return matchMedia("(prefers-reduced-motion: reduce)").matches
      ? JSON.stringify(await reduced(host, draw, final))
      : JSON.stringify({ blocks, ...(await paced(host, draw, final)) });
  } finally {
    root.unmount();
    host.remove();
  }
}

type Draw = (markdown: string, streaming: boolean, mode?: "visible" | "hidden") => void;

async function paced(host: HTMLElement, draw: Draw, final: string) {
  resetRenders(Block);
  const watcher = watch(host);
  const frames: string[] = [];
  const startedAt = performance.now();
  let markdown = "";

  for (const word of WORDS.slice(0, -1)) {
    markdown += word;
    draw(markdown, true);
    await painted();
    frames.push(watcher.observe());
  }

  const streamMs = performance.now() - startedAt;
  draw(ANSWER, true);
  const lastDelta = performance.now();
  let flushesAfterLastDelta = 0;

  while (frames.at(-1) !== final && performance.now() - lastDelta < 5_000) {
    await painted();
    const previous = frames.at(-1);
    frames.push(watcher.observe());

    if (frames.at(-1) !== previous) flushesAfterLastDelta += 1;
  }

  const completed = frames.at(-1) === final;
  const lastDeltaToFullTextMs = performance.now() - lastDelta;
  const streamed = renders();

  while (fading(host).length > 0 && performance.now() - lastDelta < 5_000) {
    await painted();
    watcher.observe();
  }

  const lastDeltaToStillMs = performance.now() - lastDelta;
  const tailSpans = chunkSpans(host);

  const settledBlockSpans = [...host.querySelectorAll("p")]
    .slice(0, -1)
    .reduce((total, paragraph) => total + chunkSpans(paragraph), 0);

  draw(ANSWER, false);
  const ended = renders();
  await sleep(1_000);
  const settlingRenders = renders() - ended;
  const spansAfterSettling = chunkSpans(host);
  const settled = renders();
  await sleep(1_000);
  const idleRenders = renders() - settled;
  draw("", false);

  return {
    deltas: WORDS.length,
    streamMs,
    textChanges: frames.filter((text, index) => text !== frames[index - 1]).length,
    markdownRenders: streamed,
    rendersPerDelta: streamed / WORDS.length,
    completed,
    offWordFrames: frames.filter(
      (text) =>
        !final.startsWith(text) ||
        (text !== final && !/\s$/u.test(text) && !/\s/u.test(final.charAt(text.length))),
    ).length,
    flushesAfterLastDelta,
    lastDeltaToFullTextMs,
    lastDeltaToStillMs,
    tailSpans,
    settledBlockSpans,
    settlingRenders,
    spansAfterSettling,
    idleRenders,
    ...watcher.report(),
    burst: await burst(host, draw),
    mount: await mount(host, draw, final),
    hidden: await hidden(host, draw),
  };
}

async function burst(host: HTMLElement, draw: Draw) {
  draw(LEAD, true);
  await painted();
  const watcher = watch(host);
  const lead = paragraphText(host);
  const whole = `${LEAD}\n\n${BURST}`;
  draw(whole, true);
  draw(whole, false);
  const endedAt = performance.now();
  const shown: number[] = [];

  while (shown.at(-1) !== BURST.length && performance.now() - endedAt < 5_000) {
    await painted();
    const text = watcher.observe().slice(lead.length).trimStart();

    if (text.length !== (shown.at(-1) ?? 0)) shown.push(text.length);
  }

  const endToFullTextMs = performance.now() - endedAt;
  const steps = shown.map((length, index) => length - (shown[index - 1] ?? 0));

  const budgets = shown.map((_, index) =>
    Math.max(24, Math.ceil((BURST.length - (shown[index - 1] ?? 0)) / (8 - index))),
  );

  draw("", false);

  return {
    flushes: shown.length,
    endToFullTextMs,
    steps,
    overBudget: steps.filter((step, index) => step > (budgets[index] ?? 0)).length,
    offWord: shown.filter((length) => length !== BURST.length && !/\s/u.test(BURST.charAt(length)))
      .length,
    ...watcher.report(),
  };
}

async function mount(host: HTMLElement, draw: Draw, final: string) {
  draw(ANSWER, true);
  await painted();
  const firstFrameWhole = paragraphText(host) === final;
  const fadingAtMount = fading(host).length;
  const spansAtMount = chunkSpans(host);
  const watcher = watch(host);
  draw(`${ANSWER} Then one more sentence arrives.`, true);

  for (let frame = 0; frame < 4; frame += 1) {
    await painted();
    watcher.observe();
  }

  draw("", false);

  return { firstFrameWhole, fadingAtMount, spansAtMount, ...watcher.report() };
}

async function hidden(host: HTMLElement, draw: Draw) {
  draw(LEAD, true);
  await painted();
  const paced = `${LEAD} ${PACED}`;
  draw(paced, true);
  await painted();
  await painted();
  const spansBeforeHiding = chunkSpans(host);
  draw(paced, true, "hidden");
  await painted();
  const whole = `${paced} ${WHILE_HIDDEN}\n\n${BURST}`;
  draw(whole, true, "hidden");
  await sleep(100);
  draw(whole, true);
  await painted();
  const firstFrameWhole = paragraphText(host) === `${paced} ${WHILE_HIDDEN}\n${BURST}`;
  let fadingAfterResume = fading(host).length;

  for (let frame = 0; frame < 10; frame += 1) {
    await painted();
    fadingAfterResume = Math.max(fadingAfterResume, fading(host).length);
  }

  const watcher = watch(host);
  const resumed = `${whole} ${AFTER_RESUME}`;
  draw(resumed, true);

  for (let frame = 0; frame < 6; frame += 1) {
    await painted();
    watcher.observe();
  }

  await sleep(300);
  draw(resumed, true, "hidden");
  await painted();
  draw(resumed, true);
  await painted();
  const again = watch(host);
  draw(`${resumed} ${AFTER_SETTLED_RESUME}`, true);

  for (let frame = 0; frame < 6; frame += 1) {
    await painted();
    again.observe();
  }

  draw("", false);

  return {
    spansBeforeHiding,
    firstFrameWhole,
    fadingAfterResume,
    afterResume: watcher.report(),
    afterSettledResume: again.report(),
  };
}

async function reduced(host: HTMLElement, draw: Draw, final: string) {
  resetRenders(Block);
  let markdown = "";
  let lagging = 0;
  let fadingMax = 0;
  let spansMax = 0;

  for (const word of WORDS) {
    markdown += word;
    draw(markdown, true);

    if (!host.textContent.endsWith(word.trimEnd().replaceAll(/[`*]/gu, ""))) lagging += 1;
    await painted();
    fadingMax = Math.max(fadingMax, fading(host).length);
    spansMax = Math.max(spansMax, chunkSpans(host));
  }

  const whole = paragraphText(host) === final;
  const rendersPerDelta = renders() / WORDS.length;
  draw("", false);

  return {
    reduced: true,
    deltas: WORDS.length,
    lagging,
    whole,
    rendersPerDelta,
    fadingMax,
    spansMax,
  };
}
