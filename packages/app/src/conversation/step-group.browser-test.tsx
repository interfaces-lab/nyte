import "../../test/window-bridge.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { Activity } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ReactNode } from "react";
import type { ToolClass } from "@nyte-ai/sdk";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { StepGroupView } from "./step-group.tsx";
import type { StepMessage } from "./transcript-presentation.ts";
import { asId } from "@nyte-ai/schema";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import { queryClient } from "../queries.ts";
import { TranscriptProvider } from "./transcript.tsx";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle() {
  for (let index = 0; index < 4; index += 1) await frame();
}

const STALL_MS = 5_000;

async function until(done: () => boolean, deadline: number) {
  while (!done() && performance.now() < deadline) await wait(50);
}

function thought(id: string, text: string, at: number, live = false): StepMessage {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">("turn"),
    at,
    kind: "part",
    part: asId<"part">(id),
    partKind: "thinking",
    role: "step",
    version: 1,
    state: { markdown: text, merged: 1, signature: null },
    status: live
      ? { kind: "live", run: asId<"run">("run") }
      : { kind: "settled", commit: asId<"commit">(id), endedAt: at },
  };
}

function read(id: string, at: number, live = false): StepMessage {
  return tool(id, { kind: "read", path: `/w/${id}.ts` }, at, live);
}

function tool(id: string, toolClass: ToolClass, at: number, live = false): StepMessage {
  const call = { call: asId<"call">(id), name: toolClass.kind, args: null, class: toolClass };

  return {
    id: asId<"message">(id),
    turn: asId<"turn">("turn"),
    at,
    kind: "part",
    part: asId<"part">(id),
    partKind: "tool",
    role: "step",
    version: 1,
    ...(live
      ? {
          state: { ...call, phase: "running", progress: null },
          status: { kind: "live", run: asId<"run">("run") },
        }
      : {
          state: {
            ...call,
            phase: "settled",
            outcome: { kind: "ok", content: [], output: null, parts: [] },
            changes: null,
          },
          status: { kind: "settled", commit: asId<"commit">(id), endedAt: at },
        }),
  };
}

function thoughts(count: number): StepMessage[] {
  return Array.from({ length: count }, (_, index) =>
    thought(String(index), `Work ${String(index)}`, index),
  );
}

const EARLIER =
  "Thinking through the reader load: either placement (`schema` or `api/hold.ts`) only adds one import hop for `engine/holds.ts`, so readability is roughly equivalent either way.\n\nI'm leaning toward keeping it in schema while rechecking the package ownership boundaries.";

const FIRST =
  "Reconsidering the ownership rule, the parenthetical about touching `heads.ts` may only cover removing the `until` field, not adding a new constant. The owner might read a public export there as overreach, even though they asked for a single source of truth for the lease length. Placing the constant in schema risks scope creep into the public API surface.";

const SECOND =
  "Since `until` isn't needed separately anymore, I'm inlining it into the hold record rather than computing it beforehand, returning `{ kind: \"held\" }` when the write succeeds and `STALE` otherwise.\n\nLooking at the existing import patterns, value imports and type imports stay separate.";

const THIRD = Array.from(
  { length: 60 },
  (_, index) => `Checking call site ${String(index + 1)} for the old lease helper.`,
).join(" ");

function prefix(text: string, words: number): string {
  return text
    .split(/(?<= )/u)
    .slice(0, words)
    .join("");
}

function wordCount(text: string): number {
  return text.split(/(?<= )/u).length;
}

interface Placement {
  readonly top: number;
  readonly bottom: number;
  readonly offset: number;
  readonly opacity: number;
  readonly cut: boolean;
}

function place(box: HTMLElement, node: Text, start: number, end: number): Placement | undefined {
  const parent = node.parentElement;

  if (parent === null || !parent.checkVisibility({ contentVisibilityAuto: true })) return undefined;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const rect = range.getBoundingClientRect();

  if (rect.height === 0) return undefined;
  const bounds = box.getBoundingClientRect();
  const content = box.firstElementChild?.getBoundingClientRect().top ?? bounds.top;
  let opacity = 1;
  let cut = rect.top < bounds.top - 0.5 || rect.bottom > bounds.bottom + 0.5;

  for (
    let element: HTMLElement | null = parent;
    element !== null && element !== box;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    opacity *= Number(style.opacity);

    if (style.overflowY === "visible") continue;
    const clip = element.getBoundingClientRect();
    cut ||= rect.top < clip.top - 0.5 || rect.bottom > clip.bottom + 0.5;
  }

  return {
    top: rect.top - bounds.top,
    bottom: rect.bottom - bounds.top,
    offset: rect.top - content,
    opacity,
    cut,
  };
}

function textNodes(box: HTMLElement): Text[] {
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
    if (node instanceof Text && /\S/u.test(node.data)) nodes.push(node);

  return nodes;
}

function word(box: HTMLElement, text: string): Placement | undefined {
  const node = textNodes(box).findLast((candidate) => candidate.data.includes(text));
  const start = node?.data.lastIndexOf(text) ?? -1;

  return node === undefined ? undefined : place(box, node, start, start + text.length);
}

function newest(box: HTMLElement): Placement | undefined {
  const node = textNodes(box).at(-1);
  const end = node?.data.trimEnd().length ?? 0;

  return node === undefined ? undefined : place(box, node, end - 1, end);
}

function atEnd(box: HTMLElement): boolean {
  return box.scrollHeight - box.clientHeight - box.scrollTop <= 1;
}

const SHELL: ToolClass = { kind: "shell", command: "pnpm lint" };

const EDIT: ToolClass = { kind: "edit", path: "/w/lease.ts" };

interface Change {
  readonly at: number;
  readonly label: string;
}

function header(box: HTMLElement): string {
  return box.querySelector("button")?.firstElementChild?.textContent ?? "";
}

function recordLabels(box: HTMLElement, label: () => string) {
  const changes: Change[] = [{ at: performance.now(), label: label() }];

  const observer = new MutationObserver(() => {
    const next = label();

    if (next !== changes.at(-1)?.label) changes.push({ at: performance.now(), label: next });
  });

  observer.observe(box, { subtree: true, childList: true, characterData: true, attributes: true });

  return { changes, stop: () => observer.disconnect() };
}

function timeline(changes: readonly Change[], from: number): string {
  return changes
    .map((change) => `${change.label} @${String(Math.round(change.at - from))}ms`)
    .join(" → ");
}

async function startSlowProbe() {
  const lane = document.createElement("div");
  lane.style.cssText = "position:fixed;right:0;bottom:0;width:480px";
  document.body.append(lane);
  const root = createRoot(lane);

  const render = (messages: readonly StepMessage[], mode: "visible" | "hidden" = "visible") =>
    flushSync(() =>
      root.render(
        <Activity mode={mode}>
          <StepGroupView
            messages={messages}
            cwd={undefined}
            added={0}
            removed={0}
            running
            density="compact"
          />
        </Activity>,
      ),
    );

  render([read("probe", 0, true)]);
  await settle();
  check(header(lane) === "Exploring", "A live group names the read in flight");
  const labels = recordLabels(lane, () => header(lane));
  const settled = performance.now();
  const probe = read("probe", 0);
  render([probe]);

  return async () => {
    await until(
      () => labels.changes.some((change) => change.label === "Taking longer than expected…"),
      settled + 15_000 + STALL_MS,
    );
    labels.stop();
    const seen = timeline(labels.changes, settled);
    const planning = labels.changes[1];
    const slow = labels.changes[2];

    check(
      labels.changes.length === 3 &&
        planning?.label === "Planning next moves" &&
        planning.at - settled >= 200 &&
        planning.at - settled <= 200 + STALL_MS,
      `A finished step keeps its verb for 200 ms, then the header plans: ${seen}`,
    );
    check(
      slow?.label === "Taking longer than expected…" &&
        slow.at - settled >= 15_000 &&
        slow.at - settled <= 15_000 + STALL_MS,
      `After 15 s of planning the header says it is taking longer: ${seen}`,
    );

    render([probe, read("hidden", 1, true)], "hidden");
    await until(() => (lane.textContent ?? "").includes("hidden.ts"), performance.now() + STALL_MS);
    render([probe, read("hidden", 1)], "hidden");
    await settle();
    const replans = recordLabels(lane, () => header(lane));
    const revealed = performance.now();
    render([probe, read("hidden", 1)]);
    await until(() => replans.changes.length > 1, revealed + 200 + STALL_MS);
    replans.stop();
    flushSync(() => root.unmount());
    lane.remove();
    const replanned = replans.changes[1];

    check(
      replans.changes.length === 2 &&
        replanned?.label === "Planning next moves" &&
        replanned.at - revealed >= 200,
      `Work done while the chat is hidden restarts the planning clock: ${timeline(replans.changes, revealed)}`,
    );
  };
}

async function quickSteps(outer: HTMLElement, render: (messages: readonly StepMessage[]) => void) {
  render([read("quick-a", 0, true)]);
  await wait(300);
  check(header(outer) === "Exploring", "A live group names the read in flight");
  const labels = recordLabels(outer, () => header(outer));
  const a = read("quick-a", 0);
  const b = tool("quick-b", SHELL, 1);
  const c = read("quick-c", 2);
  const started = performance.now();

  for (const messages of [
    [a],
    [a, tool("quick-b", SHELL, 1, true)],
    [a, b],
    [a, b, read("quick-c", 2, true)],
    [a, b, c],
    [a, b, c, tool("quick-d", EDIT, 3, true)],
  ]) {
    render(messages);
    await frame();
  }

  await wait(450);
  labels.stop();
  const seen = timeline(labels.changes, started);
  const changes = labels.changes.slice(1);

  check(
    changes.every((change) => ["Exploring", "Running", "Editing"].includes(change.label)),
    `Quick steps never flash a planning label: ${seen}`,
  );
  check(
    changes.slice(1).every((change, index) => change.at - (changes[index]?.at ?? 0) >= 190),
    `The header changes at most once per 200 ms: ${seen}`,
  );
  check(labels.changes.at(-1)?.label === "Editing", `The header lands on the newest step: ${seen}`);
}

async function planningSteps(
  outer: HTMLElement,
  render: (messages: readonly StepMessage[]) => void,
) {
  const a = read("plan-a", 0);
  const b = tool("plan-b", SHELL, 1);
  render([a]);
  await settle();
  check(
    header(outer) === "Planning next moves",
    `A live group with nothing in flight says it is planning (saw ${header(outer)})`,
  );
  await wait(300);
  render([a, tool("plan-b", SHELL, 1, true)]);
  await settle();
  check(header(outer) === "Running", `A running command names its verb (saw ${header(outer)})`);
  await wait(300);
  render([a, b, thought("plan-c", "Weighing the lease", 2, true)]);
  await settle();
  check(header(outer) === "Thinking", `Live thinking names itself (saw ${header(outer)})`);
  await wait(300);
  const labels = recordLabels(outer, () => header(outer));
  const settled = performance.now();
  render([a, b, thought("plan-c", "Weighing the lease", 2)]);
  await until(
    () => labels.changes.some((change) => change.label === "Planning next moves"),
    settled + 200 + STALL_MS,
  );
  labels.stop();
  const seen = timeline(labels.changes, settled);
  const planning = labels.changes[1];

  check(
    labels.changes.length === 2 &&
      planning?.label === "Planning next moves" &&
      planning.at - settled >= 200 &&
      planning.at - settled <= 200 + STALL_MS,
    `Finished thinking holds its label for 200 ms, then the header plans: ${seen}`,
  );
}

async function liveSequence(outer: HTMLElement, root: Root) {
  const render = (messages: readonly StepMessage[], mode: "visible" | "hidden" = "visible") =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Activity mode={mode}>
            <StepGroupView
              messages={messages}
              cwd={undefined}
              added={0}
              removed={0}
              running
              density="compact"
            />
          </Activity>
        </QueryClientProvider>,
      ),
    );

  const lead = [read("lead", 0), thought("earlier", EARLIER, 1)];
  render([...lead, thought("first", "", 2, true)]);
  await settle();
  const box = outer.querySelector("[data-step-preview]");
  const calls = box?.firstElementChild;

  if (!(box instanceof HTMLElement) || calls === null || calls === undefined)
    throw new Error("A live group shows its preview");

  let failure: string | undefined;
  let pinned = true;
  let step = "streaming the first thought";

  const checkPinned = (): void => {
    const line = newest(box);

    if (failure !== undefined || !pinned) return;

    if (!atEnd(box)) failure = `While ${step}, the pinned preview left the end`;
    else if (line === undefined || line.cut)
      failure = `While ${step}, the newest line is cut off at the bottom`;
  };

  let pinnedFrame = new ResizeObserver(checkPinned);
  pinnedFrame.observe(calls);

  const next = async (expect: () => void = () => undefined) => {
    await frame();

    if (failure !== undefined) throw new Error(failure);
    check(
      textNodes(box).some((node) => {
        const seen = place(box, node, 0, node.data.length);

        return seen !== undefined && !seen.cut && seen.opacity >= 0.3;
      }),
      `While ${step}, the preview shows nothing readable`,
    );
    expect();
  };

  const stream = async (messages: (text: string) => readonly StepMessage[], text: string) => {
    for (let count = 1; count <= wordCount(text); count += 2) {
      render(messages(prefix(text, count)));
      await next();
      await next();
    }

    render(messages(text));
    await next();
  };

  await stream((text) => [...lead, thought("first", text, 2, true)], FIRST);

  for (let index = 0; (word(box, "surface.")?.opacity ?? 0) < 0.49; index += 1) {
    check(index < 120, "The streamed thought shows its last words");
    await next();
  }

  check(box.hasAttribute("data-overflow"), "The streamed thought overflows the preview");
  const done = word(box, "surface.");

  if (done === undefined) throw new Error("The finished thought's last line is on screen");
  const first = thought("first", FIRST, 2);

  const unmoved = (what: string) => {
    const line = word(box, "surface.");

    check(
      line !== undefined && Math.abs(line.offset - done.offset) <= 0.5,
      `${what}: the finished thought moved within the step list (${String(done.offset)} → ${String(line?.offset)})`,
    );
  };

  const shown = (what: string) => {
    const line = word(box, "surface.");

    check(
      line !== undefined && !line.cut && line.opacity >= 0.45,
      `${what}: the finished thought left the preview (opacity ${String(line?.opacity)}, cut ${String(line?.cut)})`,
    );
  };

  step = "finishing the first thought";
  render([...lead, first]);

  for (let index = 0; index < 30; index += 1)
    await next(() => {
      unmoved("Finishing it");
      shown("Finishing it");
    });

  step = "starting the next thought";
  const height = box.scrollHeight;
  render([...lead, first, thought("second", "", 3, true)]);

  for (let index = 0; index < 40; index += 1)
    await next(() => {
      check(box.scrollHeight === height, "An empty thought adds no height to the preview");
      unmoved("Before the next thought has text");
      shown("Before the next thought has text");
    });

  step = "streaming the next thought";
  let last = word(box, "surface.")?.top ?? 0;

  for (let count = 1; count <= wordCount(SECOND); count += 2) {
    render([...lead, first, thought("second", prefix(SECOND, count), 3, true)]);

    for (let index = 0; index < 2; index += 1)
      await next(() => {
        const line = word(box, "surface.");
        unmoved("Streaming the next thought");
        check(
          line !== undefined && line.top <= last + 0.5,
          "Earlier text only moves up as new text pins at the bottom",
        );
        check(
          line === undefined || line.cut || line.opacity >= 0.45,
          "Earlier text stays readable while the next thought streams",
        );
        last = line?.top ?? last;
      });
  }

  const second = thought("second", SECOND, 3);
  step = "starting a tool call";
  render([...lead, first, second, read("call", 4, true)]);

  for (let index = 0; index < 10; index += 1) await next(() => unmoved("Starting a tool call"));
  step = "waiting for the third thought";
  const called = [...lead, first, second, read("call", 4)];
  const toolHeight = box.scrollHeight;
  render([...called, thought("third", "", 5, true)]);

  for (let index = 0; index < 20; index += 1)
    await next(() => {
      check(box.scrollHeight === toolHeight, "An empty thought after a tool call adds no height");
      unmoved("Waiting for the third thought");
    });

  step = "streaming the third thought";
  let words = 48;
  await stream((text) => [...called, thought("third", text, 5, true)], prefix(THIRD, words));

  step = "reading above the end";
  pinned = false;
  box.dispatchEvent(new WheelEvent("wheel", { deltaY: -60 }));
  box.scrollTop -= 60;
  await settle();
  const held = box.scrollTop;
  check(!atEnd(box), "The reader scrolled up from the end");
  const started = performance.now();

  while (performance.now() - started < 10_500) {
    words += 1;
    render([...called, thought("third", prefix(THIRD, words), 5, true)]);
    await wait(250);
    check(
      Math.abs(box.scrollTop - held) <= 0.5,
      `Streaming keeps the reader's place (${String(held)} → ${String(box.scrollTop)} after ${String(Math.round(performance.now() - started))} ms)`,
    );
  }

  step = "hiding and showing the chat";
  const current = [...called, thought("third", prefix(THIRD, words), 5, true)];
  render(current, "hidden");
  await settle();
  render(current);
  await settle();
  check(
    Math.abs(box.scrollTop - held) <= 0.5,
    `Showing the chat again keeps the reader's place (${String(held)} → ${String(box.scrollTop)})`,
  );
  words += 4;
  render([...called, thought("third", prefix(THIRD, words), 5, true)]);
  await settle();
  check(
    Math.abs(box.scrollTop - held) <= 0.5,
    `The reader stays unpinned after the chat shows again (${String(held)} → ${String(box.scrollTop)})`,
  );
  pinnedFrame.disconnect();
  pinnedFrame = new ResizeObserver(checkPinned);
  pinnedFrame.observe(calls);

  step = "returning to the end";
  box.dispatchEvent(new WheelEvent("wheel", { deltaY: 60 }));
  box.scrollTop = box.scrollHeight;
  await settle();
  pinned = true;

  for (let index = 0; index < 12; index += 1) {
    words += 1;
    render([...called, thought("third", prefix(THIRD, words), 5, true)]);
    await next();
    await next();
  }

  step = "shrinking at the end";
  render([...called, thought("third", prefix(THIRD, words - 8), 5, true)]);
  await settle();
  check(atEnd(box), "Content shrinking at the end stays pinned");
  render([...called, thought("third", prefix(THIRD, words + 4), 5, true)]);
  await settle();

  if (failure !== undefined) throw new Error(failure);
  pinnedFrame.disconnect();
}

export async function run() {
  const outer = document.createElement("div");
  outer.style.cssText = "height:400px;overflow:auto;position:relative";
  document.body.append(outer);
  const root = createRoot(outer);

  const render = (messages: readonly StepMessage[], running: boolean) =>
    flushSync(() =>
      root.render(
        <StepGroupView
          messages={messages}
          cwd={undefined}
          added={0}
          removed={0}
          running={running}
          density="compact"
        />,
      ),
    );

  const paragraphs = () => Array.from(outer.querySelectorAll("p"));
  const paragraph = (text: string) => paragraphs().find((node) => node.textContent === text);

  try {
    const slow = await startSlowProbe();
    await quickSteps(outer, (messages) => render(messages, true));
    flushSync(() => root.render(null));
    await planningSteps(outer, (messages) => render(messages, true));
    flushSync(() => root.render(null));
    await liveSequence(outer, root);
    flushSync(() => root.render(null));

    render(thoughts(43), true);
    await settle();
    const preview = outer.querySelector("[data-nyte-scrollport]");

    if (!(preview instanceof HTMLElement)) throw new Error("A running group shows its preview");
    check(preview.clientHeight === 144, "The preview caps at six rows");
    check(atEnd(preview), "The preview follows its newest output");
    check(preview.hasAttribute("data-overflow"), "Overflowing previews fade their top");

    const newestParagraph = paragraph("Work 42");
    const toggle = outer.querySelector("button");

    if (!(toggle instanceof HTMLButtonElement)) throw new Error("Missing group disclosure");
    preview.dispatchEvent(new WheelEvent("wheel", { deltaY: -60 }));
    preview.scrollTop = 0;
    await settle();
    check(!atEnd(preview), "The reader scrolls the preview up");
    newestParagraph?.click();
    await settle();
    check(toggle.getAttribute("aria-expanded") === "true", "Clicking the preview opens the group");
    check(paragraph("Work 42") === newestParagraph, "Opening keeps the clicked row mounted");
    check(paragraphs().length === 43, "The opened group lists every step");
    check(outer.querySelector("[data-nyte-scrollport]") === null, "The opened list is not clipped");

    toggle.click();
    await settle();
    const returned = outer.querySelector("[data-nyte-scrollport]");
    check(returned !== null, "Closing the list returns the live group to its preview");
    check(
      returned instanceof HTMLElement && atEnd(returned),
      "A preview back from the open list starts pinned at its end",
    );
    check(
      toggle.getAttribute("aria-expanded") === "false",
      "The preview does not read as expanded",
    );

    flushSync(() => root.render(null));
    render(thoughts(3), true);
    await settle();
    check(outer.querySelector("[data-nyte-scrollport]") !== null, "A fresh live group previews");
    render(thoughts(3), false);
    await settle();
    check(paragraphs().length === 0, "A settled compact group collapses");

    flushSync(() => root.render(null));
    render(thoughts(250), false);
    await settle();
    outer.querySelector("button")?.click();
    await settle();
    check(paragraphs().length === 200, "A long group opens on its newest steps");

    const earlier = Array.from(outer.querySelectorAll("button")).find(
      (button) => button.textContent === "Show 50 earlier steps",
    );

    if (earlier === undefined) throw new Error("Missing earlier steps control");
    earlier.click();
    await settle();
    check(paragraphs().length === 250, "Earlier steps reveal the whole group");
    check(
      document.activeElement !== document.body && outer.contains(document.activeElement),
      "Revealing earlier steps keeps focus in the group",
    );

    const firstThought = thought("thought-0", "First thought", 0);
    const streamingThought = thought("thought-1", "Streaming thought", 1, true);
    const settledThought = thought("thought-1", "Streaming thought", 1);

    const group = (messages: readonly StepMessage[], running: boolean) => (
      <StepGroupView
        messages={messages}
        cwd={undefined}
        added={0}
        removed={0}
        running={running}
        density="detailed"
      />
    );

    flushSync(() => root.render(null));
    flushSync(() => root.render(group([firstThought], false)));
    await settle();
    const thoughtToggle = outer.querySelector("button");

    if (!(thoughtToggle instanceof HTMLButtonElement))
      throw new Error("Missing thought disclosure");
    thoughtToggle.click();
    await settle();
    flushSync(() => root.render(group([firstThought, streamingThought], true)));
    await settle();

    const firstParagraph = Array.from(outer.querySelectorAll("p")).find(
      (node) => node.textContent === "First thought",
    );

    const streamedParagraph = Array.from(outer.querySelectorAll("p")).find(
      (node) => node.textContent === "Streaming thought",
    );

    check(firstParagraph !== undefined, "Earlier settled thought is visible");
    check(streamedParagraph !== undefined, "Streaming thought is visible");
    flushSync(() => root.render(group([firstThought, settledThought], false)));
    await settle();
    check(
      Array.from(outer.querySelectorAll("p")).find(
        (node) => node.textContent === "First thought",
      ) === firstParagraph,
      "Settling does not remount older reasoning",
    );
    check(
      Array.from(outer.querySelectorAll("p")).find(
        (node) => node.textContent === "Streaming thought",
      ) === streamedParagraph,
      "Settling a streamed thought preserves its row",
    );

    const panes = new PaneController({ storageKey: "step-group-test" });

    const transcript = (node: ReactNode) =>
      flushSync(() =>
        root.render(
          <PaneControllerProvider controller={panes}>
            <TranscriptProvider paneId="primary" sessionId={asId<"session">("step-group-test")}>
              {node}
            </TranscriptProvider>
          </PaneControllerProvider>,
        ),
      );

    const compact = (key: string, message: StepMessage) => (
      <StepGroupView
        key={key}
        messages={[message]}
        cwd={undefined}
        added={0}
        removed={0}
        running
        density="compact"
      />
    );

    const expandedState = () => outer.querySelector("button")?.getAttribute("aria-expanded");

    transcript(compact("live", thought("live-3", "Live thought", 0, true)));
    await settle();
    outer.querySelector("button")?.click();
    await settle();
    check(expandedState() === "true", "A live group opens");
    transcript(compact("durable", thought("live-3", "Live thought", 0)));
    await settle();
    check(expandedState() === "true", "The settled group keeps the live group open");
    transcript(compact("later", thought("live-4", "Live thought", 0, true)));
    await settle();
    check(expandedState() === "false", "A later live group starts from its density default");
    await slow();

    return "passed";
  } finally {
    flushSync(() => root.unmount());
    outer.remove();
  }
}

applyDisplayMode("light");
