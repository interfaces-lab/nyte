import "./transcript-render-counter.ts";
import "../../test/window-bridge.ts";
import { Block } from "streamdown";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { showsText } from "@nyte-ai/plugin/client/presentation";
import type { Message, RunView, SessionId, SessionView } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { Activity } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import "../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import type { ViewStream } from "../../test/scripted-connection.ts";
import { USAGE } from "../../test/view-fixtures.ts";
import { installConnection, sessionWatch, showTranscript, useWatchSelect } from "../sdk.tsx";
import { useMountEffect } from "../use-mount-effect.ts";
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

const WHILE_HIDDEN = "These words arrive while another chat is open.";

const AFTER_RESUME = "Fresh words arrive after the switch back.";

const FADES = "[data-sd-animate]";

type Draw = (markdown: string, streaming: boolean, mode?: "visible" | "hidden") => Promise<void>;

const liveRun: RunView = {
  id: asId<"run">("run"),
  head: asId<"head">("main"),
  startedAt: 0,
  attempt: 1,
  configuration: {
    kind: "exact",
    model: { provider: "test", id: "test" },
    thinking: "off",
    agent: null,
    settings: {},
    settingsVersion: "1",
  },
  origin: { kind: "input", message: asId<"message">("prompt") },
};

const base = {
  revision: asId<"revision">("r1"),
  seq: asSeq(1),
  activation: { kind: "active" },
  queue: [],
  leadingPrompt: null,
  parts: [],
  turns: [],
  usage: USAGE,
  execution: { kind: "live", run: liveRun, phase: "responding", stopping: false },
  reportsHeld: false,
  background: [],
  configuration: { selected: liveRun.configuration, effective: liveRun.configuration },
  context: { tokens: 0, window: 1_000, lastRequest: null },
  heads: [],
  changes: [],
  catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
} as const satisfies Omit<SessionView, "messages">;

const streams = new Map<SessionId, ViewStream>();

installConnection(scriptedConnection({ views: streams }).connection);

function answerView(session: SessionId, markdown: string, live: boolean): SessionView {
  const answer: Message = {
    id: asId<"message">(`${session}-answer`),
    turn: asId<"turn">(`${session}-turn`),
    at: 1,
    kind: "part",
    part: asId<"part">(`${session}-answer`),
    partKind: "text",
    role: "answer",
    state: { markdown, signature: null },
    version: 1,
    status: live
      ? { kind: "live", run: liveRun.id }
      : { kind: "settled", commit: asId<"commit">(`${session}-answer`), endedAt: 1 },
  };

  return { ...base, messages: [answer] };
}

function Answer({ session }: { readonly session: SessionId }): ReactElement | null {
  const answer = useWatchSelect(sessionWatch(session), (state) =>
    state.value?.messages.findLast(showsText),
  );

  useMountEffect(() => showTranscript(session));

  if (answer === undefined) return null;

  return <Prose markdown={answer.state.markdown} streaming={answer.status.kind === "live"} />;
}

function drawer(root: Root): Draw {
  const client = new QueryClient();
  let chats = 0;
  let current: { readonly id: SessionId; readonly release: () => void } | undefined;

  const render = (content: ReactElement | null): void =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>{content}</TooltipProvider>
        </QueryClientProvider>,
      ),
    );

  return async (markdown, streaming, mode = "visible") => {
    if (markdown === "") {
      render(null);
      current?.release();
      current = undefined;

      return;
    }

    if (current === undefined) {
      chats += 1;
      const id = asId<"session">(`chat-${String(chats)}`);
      streams.set(id, viewStream(answerView(id, markdown, streaming)));
      current = { id, release: sessionWatch(id).subscribe(() => undefined) };
      await sessionWatch(id).first();
    } else {
      const arrived = sessionWatch(current.id).next();
      streams.get(current.id)?.push(answerView(current.id, markdown, streaming));
      await arrived;
    }

    const session = current.id;

    render(
      <Activity mode={mode}>
        <Answer session={session} />
      </Activity>,
    );
  };
}

const painted = (): Promise<number> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(() => resolve(performance.now()), 0));
  });

async function still(host: HTMLElement): Promise<void> {
  const since = performance.now();

  while (fading(host).length > 0 && performance.now() - since < 2_000) await painted();
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function renders(): number {
  const counts = renderCount(Block);

  return counts.mounts + counts.updates;
}

function fading(host: HTMLElement): Element[] {
  return host
    .getAnimations({ subtree: true })
    .flatMap((animation) =>
      (animation.playState === "running" || animation.pending) &&
      animation.effect instanceof KeyframeEffect &&
      animation.effect.target !== null &&
      Number(animation.effect.getComputedTiming().duration) > 0
        ? [animation.effect.target]
        : [],
    );
}

function spanParagraphs(host: HTMLElement): number[] {
  return [...host.querySelectorAll("p")].flatMap((paragraph, index) =>
    paragraph.querySelector(FADES) === null ? [] : [index],
  );
}

function durations(root: Element): string[] {
  return [
    ...new Set(
      [...root.querySelectorAll(FADES)].flatMap((element) =>
        element instanceof HTMLElement ? [element.style.getPropertyValue("--sd-duration")] : [],
      ),
    ),
  ].toSorted();
}

function animationStyle(element: Element) {
  const style = getComputedStyle(element);

  return {
    animated: style.animationName !== "none",
    duration: style.animationDuration,
    timing: style.animationTimingFunction,
    fill: style.animationFillMode,
  };
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
  const seen = new Set<string>();
  let previous = host.textContent;
  let staleFades = 0;
  let replays = 0;
  let oldestFadeMs = 0;
  let fadingMax = 0;
  let spanParagraphsMax = 0;
  let codeTextFades = 0;
  let fadesAroundCode = 0;
  let fresh: ReturnType<typeof animationStyle> | undefined;
  let settled: ReturnType<typeof animationStyle> | undefined;

  return {
    observe(): string {
      const now = performance.now();
      const targets = fading(host);

      for (const target of targets) {
        if (ended.has(target)) replays += 1;
        oldestFadeMs = Math.max(oldestFadeMs, now - (started.get(target) ?? now));

        if (target.closest("code") !== null) codeTextFades += 1;

        if (target.querySelector("code") !== null) fadesAroundCode += 1;

        if (started.has(target)) continue;
        started.set(target, now);

        if (textBefore(host, target) < previous.length) staleFades += 1;
      }

      for (const target of started.keys()) if (!targets.includes(target)) ended.add(target);

      for (const element of host.querySelectorAll(FADES)) {
        if (!(element instanceof HTMLElement)) continue;

        const duration = element.style.getPropertyValue("--sd-duration");
        seen.add(duration);

        if (duration === "150ms") fresh ??= animationStyle(element);

        if (duration === "0ms") settled ??= animationStyle(element);
      }

      fadingMax = Math.max(fadingMax, targets.length);
      spanParagraphsMax = Math.max(spanParagraphsMax, spanParagraphs(host).length);
      previous = host.textContent;

      return paragraphText(host);
    },
    report: () => ({
      staleFades,
      replays,
      oldestFadeMs,
      fadingMax,
      spanParagraphsMax,
      codeTextFades: codeTextFades > 0,
      fadesAroundCode,
      durations: [...seen].toSorted(),
      fresh,
      settled,
    }),
  };
}

export async function run(): Promise<string> {
  applyDisplayMode("light");
  const host = document.createElement("div");
  host.style.width = "640px";
  document.body.append(host);
  const root = createRoot(host);
  const draw = drawer(root);

  try {
    await draw(ANSWER, false);
    await painted();
    const final = paragraphText(host);
    const blocks = host.querySelectorAll("p").length;
    const staticSpans = host.querySelectorAll(FADES).length;
    await draw("", false);

    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      return JSON.stringify({
        reduced: true,
        catchUp: await burst(host, draw, true),
        drain: await burst(host, draw, false),
      });

    return JSON.stringify({
      blocks,
      staticSpans,
      stream: await stream(host, draw, final),
      catchUp: await burst(host, draw, true),
      drain: await burst(host, draw, false),
      mount: await mount(host, draw, final),
      hidden: await hidden(host, draw),
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

async function stream(host: HTMLElement, draw: Draw, final: string) {
  resetRenders(Block);
  const watcher = watch(host);
  const frames: string[] = [];
  let markdown = "";

  for (const word of WORDS.slice(0, -1)) {
    markdown += word;
    await draw(markdown, true);
    await painted();
    frames.push(watcher.observe());
  }

  await draw(ANSWER, true);
  const lastDelta = performance.now();

  while (frames.at(-1) !== final && performance.now() - lastDelta < 2_000) {
    await painted();
    frames.push(watcher.observe());
  }

  const lastFadeAt = performance.now();
  const streamed = renders();
  await draw(ANSWER, false);
  const ended = renders();
  const spansAtEnd = spanParagraphs(host);

  while (host.querySelector(FADES) !== null && performance.now() - lastFadeAt < 2_000) {
    await painted();
    watcher.observe();
  }

  const releaseMs = performance.now() - lastFadeAt;
  await sleep(1_000);
  const settlingRenders = renders() - ended;
  const settled = renders();
  await sleep(1_000);
  const idleRenders = renders() - settled;
  await draw("", false);

  return {
    deltas: WORDS.length,
    completed: frames.at(-1) === final,
    offWordFrames: frames.filter(
      (text) =>
        !final.startsWith(text) ||
        (text !== final && !/\s$/u.test(text) && !/\s/u.test(final.charAt(text.length))),
    ).length,
    markdownRenders: streamed,
    spansAtEnd,
    releaseMs,
    settlingRenders,
    idleRenders,
    ...watcher.report(),
  };
}

async function burst(host: HTMLElement, draw: Draw, streaming: boolean) {
  await draw(LEAD, true);
  await painted();
  await still(host);
  const watcher = watch(host);
  const whole = `${LEAD}\n\n${BURST}`;
  await draw(whole, streaming);
  const startedAt = performance.now();
  const steps: number[] = [];

  while (steps.at(-1) !== BURST.length && performance.now() - startedAt < 5_000) {
    await painted();
    watcher.observe();
    const length = host.querySelectorAll("p").item(1)?.textContent.length ?? 0;

    if (length !== (steps.at(-1) ?? 0)) steps.push(length);
  }

  const fullTextMs = performance.now() - startedAt;
  await draw(whole, false);
  const spansAfterEnd = host.querySelectorAll(FADES).length;
  await draw("", false);

  return { steps, fullTextMs, spansAfterEnd, ...watcher.report() };
}

async function mount(host: HTMLElement, draw: Draw, final: string) {
  await draw(ANSWER, true);
  await painted();

  const result = {
    firstFrameWhole: paragraphText(host) === final,
    spanParagraphs: spanParagraphs(host),
    durations: durations(host),
    fades: fading(host).length > 0,
  };

  await draw("", false);

  return result;
}

async function hidden(host: HTMLElement, draw: Draw) {
  await draw(LEAD, true);
  await painted();
  const whole = `${LEAD}\n\n${BURST}`;
  await draw(whole, true);
  await painted();
  const pacingBeforeHiding = paragraphText(host) !== `${LEAD}\n${BURST}`;
  await draw(whole, true, "hidden");
  await painted();
  const more = `${whole} ${WHILE_HIDDEN}`;
  await draw(more, true, "hidden");
  await sleep(100);
  await draw(more, true);
  await painted();
  const firstFrameWhole = paragraphText(host) === `${LEAD}\n${BURST} ${WHILE_HIDDEN}`;

  await still(host);
  const watcher = watch(host);
  await draw(`${more} ${AFTER_RESUME}`, true);

  for (let frame = 0; frame < 6; frame += 1) {
    await painted();
    watcher.observe();
  }

  await draw("", false);

  return { pacingBeforeHiding, firstFrameWhole, afterResume: watcher.report() };
}
