import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type {
  Delivery,
  Message,
  ModelCatalogView,
  RunView,
  SessionView,
  ToolClass,
  TurnInfo,
} from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import type { HostState } from "../nyte.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import { SessionDndProvider } from "../layout/session-dnd.tsx";
import { keys, queryClient } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { SessionScreen } from "./session-screen.tsx";
import { createAppRouter } from "../router.tsx";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { USAGE, endedTurn, sessionRow, settledTool } from "../../test/view-fixtures.ts";

const ID = asId<"session">("session-screen-render");

const TURNS = 32;

const TALL_PROMPT = 20;

const liveRun: RunView = {
  id: asId<"run">("live-run"),
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
  origin: { kind: "input", message: asId<"message">("prompt-32") },
};

const turnId = (index: number) => asId<"turn">(`turn-${String(index)}`);

type UserMessage = Extract<Message, { readonly kind: "user" }>;

function user(id: string, turn: number, text: string, delivery: Delivery = "queue"): UserMessage {
  return {
    id: asId<"message">(id),
    turn: turnId(turn),
    at: turn,
    kind: "user",
    content: text,
    source: { kind: "user" },
    delivery,
    status: { kind: "landed", commit: asId<"commit">(id), run: null, replaced: null },
    siblings: { index: 0, count: 1, ids: [] },
  };
}

function prose(id: string, turn: number, markdown: string, live = false): Message {
  return {
    id: asId<"message">(id),
    turn: turnId(turn),
    at: turn,
    kind: "part",
    part: asId<"part">(id),
    partKind: "text",
    role: "answer",
    state: { markdown, signature: null },
    version: 1,
    status: live
      ? { kind: "live", run: liveRun.id }
      : { kind: "settled", commit: asId<"commit">(id), endedAt: turn },
  };
}

function tool(id: string, turn: number, toolClass: ToolClass): Message {
  return { ...settledTool(id, toolClass, "ok"), turn: turnId(turn) };
}

const sentence = "The transcript holds its place while replies stream in below the reader. ";

function paragraphs(seed: number): string {
  return Array.from(
    { length: 1 + (seed % 3) },
    (_, index) =>
      `Paragraph ${String(index + 1)} of turn ${String(seed)}. ${sentence.repeat(1 + ((seed + index) % 4))}`,
  ).join("\n\n");
}

function prompt(index: number): UserMessage {
  const lines = index === TALL_PROMPT ? 60 : 2;

  return user(
    `prompt-${String(index)}`,
    index,
    `Question ${String(index)}\n${"Line of the prompt\n".repeat(lines)}`,
  );
}

function turnMessages(index: number): Message[] {
  const file = `src/file-${String(index)}.ts`;
  const messages: Message[] = [prompt(index)];

  if (index % 2 === 1) {
    messages.push(tool(`read-${String(index)}`, index, { kind: "read", path: file }));
    messages.push(tool(`edit-${String(index)}`, index, { kind: "edit", path: file }));
  }

  messages.push(prose(`answer-${String(index)}`, index, paragraphs(index)));

  if (index % 7 === 0) {
    messages.push(user(`steer-${String(index)}`, index, `Steering note ${String(index)}`, "steer"));
    messages.push(prose(`followup-${String(index)}`, index, `After steering ${String(index)}.`));
  }

  return messages;
}

const continuation = asId<"turn">("continuation-10");

const ended: TurnInfo["state"] = { kind: "ended", end: { kind: "completed", usage: USAGE } };

function view(
  liveText: string,
  extra: readonly Message[] = [],
  extraTurns: readonly TurnInfo[] = [],
): SessionView {
  const messages: Message[] = [];
  const turns: TurnInfo[] = [];

  for (let index = 1; index <= TURNS; index += 1) {
    const live = index === TURNS;

    const own = live
      ? [
          prompt(index),
          tool(`read-${String(index)}`, index, { kind: "shell", command: "pnpm test" }),
          tool(`edit-${String(index)}`, index, { kind: "edit", path: "src/file.ts" }),
          prose(`answer-${String(index)}`, index, "A short first answer."),
          user(`steer-${String(index)}`, index, "Keep going, but shorter.", "steer"),
          prose(`live-${String(index)}`, index, liveText, true),
        ]
      : turnMessages(index);

    messages.push(...own);
    turns.push(
      endedTurn([], {
        id: turnId(index),
        prompt: asId<"message">(`prompt-${String(index)}`),
        run: live ? liveRun.id : null,
        state: live ? { kind: "working", activity: null } : ended,
        steps: own.length,
      }).info,
    );

    if (index === 10) {
      const report = tool("report-10", 10, { kind: "shell", command: "git status" });
      messages.push({ ...report, turn: continuation });
      messages.push({
        ...prose("report-text-10", 10, "Background report folded in."),
        turn: continuation,
      });
      turns.push(endedTurn([], { id: continuation, prompt: null, steps: 2 }).info);
    }
  }

  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(1),
    activation: { kind: "active" },
    messages: [...messages, ...extra],
    leadingPrompt: null,
    parts: [],
    turns: [...turns, ...extraTurns],
    usage: USAGE,
    execution: { kind: "live", run: liveRun, phase: "responding", stopping: false },
    background: [],
    configuration: { selected: liveRun.configuration, effective: liveRun.configuration },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

let liveText = "Streaming";

const stream = viewStream(view(liveText));

const refuse = async (): Promise<never> => {
  throw new Error("Not scripted.");
};

const sends: string[] = [];

installConnection(
  scriptedConnection({
    sessions: [sessionRow("session-screen-render", { name: "Transcript rules" })],
    views: new Map([[ID, stream]]),
    session: () => ({
      send: async (content) => {
        sends.push(JSON.stringify(content));

        return {
          id: asId<"receipt">("sent"),
          message: asId<"message">("sent"),
          status: refuse,
          settled: refuse,
          stop: refuse,
          landed: refuse,
        };
      },
    }),
  }).connection,
);

const catalog = {
  generation: asId<"catalog-generation">("initial"),
  providers: [],
  default: { provider: "test", id: "test" },
} satisfies ModelCatalogView;

const host = { workspace: undefined } satisfies HostState;

let renderFailure: unknown;

const panes = new PaneController({ storageKey: "session-screen-render-test" });

panes.selectSession(ID);

function mount(container: HTMLElement): Root {
  queryClient.setQueryData(keys.host, host);
  queryClient.setQueryData(keys.modelCatalog("initial"), catalog);
  queryClient.setQueryData(keys.mentionFiles, []);
  renderFailure = undefined;

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/session/${ID}`] }),
  });

  const root = createRoot(container, {
    onUncaughtError: (error) => {
      renderFailure = error;
    },
  });

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider controller={panes}>
              <SessionDndProvider>
                <SessionScreen />
              </SessionDndProvider>
            </PaneControllerProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  return root;
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (renderFailure !== undefined) throw renderFailure;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

const failures: string[] = [];

let step = "mount";

function expectRule(rule: string, condition: boolean, detail: string): void {
  const line = `rule ${rule} (${step}): ${detail}`;

  if (!condition && !failures.includes(line)) failures.push(line);
}

interface Stage {
  readonly viewport: HTMLElement;
  readonly log: HTMLElement;
  readonly dock: HTMLElement;
}

let stage: Stage;

const PROSE = "p:not([data-sticky-user-message] *)";

function measureTop(element: Element): number {
  return Math.round(
    element.getBoundingClientRect().top - stage.viewport.getBoundingClientRect().top,
  );
}

function listRows(): HTMLElement[] {
  return Array.from(stage.log.querySelectorAll<HTMLElement>("[data-row-key]")).sort(
    (first, second) => Number(first.dataset.index) - Number(second.dataset.index),
  );
}

function visible(selector: string): HTMLElement[] {
  const bottom = measureTop(stage.dock);

  return Array.from(stage.log.querySelectorAll<HTMLElement>(selector))
    .filter((block) => {
      const height = block.getBoundingClientRect().height;

      return height > 0 && measureTop(block) >= 0 && measureTop(block) + height <= bottom;
    })
    .sort((first, second) => measureTop(first) - measureTop(second));
}

function answerIndex(row: HTMLElement): number | undefined {
  const match = /^response:answer-(\d+)$/u.exec(row.dataset.rowKey ?? "");

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function distance(): number {
  return stage.viewport.scrollHeight - stage.viewport.clientHeight - stage.viewport.scrollTop;
}

function buttonShown(): boolean {
  const button = stage.dock.querySelector("[data-slot='scroll-to-bottom']");

  return button !== null && getComputedStyle(button).visibility === "visible";
}

function checkFrame(label: string): void {
  const rows = listRows();

  for (const [index, below] of rows.entries()) {
    const above = rows[index - 1];

    const overlap =
      above === undefined
        ? 0
        : above.getBoundingClientRect().bottom - below.getBoundingClientRect().top;

    expectRule("22", overlap <= 0.5, `${label}: rows overlap by ${overlap.toFixed(1)}px`);
  }

  const last = rows.at(-1);

  const extent =
    last === undefined
      ? 0
      : stage.log.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;

  expectRule(
    "23",
    extent >= -0.5,
    `${label}: extent ends ${(-extent).toFixed(1)}px above the last row`,
  );

  const column =
    stage.viewport.getBoundingClientRect().bottom - stage.dock.getBoundingClientRect().bottom;

  expectRule(
    "13",
    Math.abs(column) <= 1,
    `${label}: composer sits ${column.toFixed(1)}px above the column's bottom`,
  );
  expectRule(
    "25",
    buttonShown() === distance() > 60,
    `${label}: button shown=${String(buttonShown())} at ${distance().toFixed(0)}px from the end`,
  );
}

function checkFollowing(label: string): void {
  checkFrame(label);
  expectRule(
    "1-4",
    Math.abs(distance()) <= 1,
    `${label}: ${distance().toFixed(1)}px from the end while following`,
  );
  const last = listRows().at(-1);

  const gap =
    last === undefined
      ? 0
      : stage.dock.getBoundingClientRect().top - last.getBoundingClientRect().bottom;

  expectRule(
    "14",
    Math.abs(gap - 114) <= 1,
    `${label}: last row ends ${gap.toFixed(1)}px above the composer`,
  );
}

async function streamFrames(count: number, verify: (label: string) => void): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    liveText += `\n\nDelta ${String(index)}: ${sentence.repeat(1 + (index % 3))}`;
    stream.push(view(liveText));
    await painted();
    verify(`stream frame ${String(index)}`);
  }
}

async function wheel(delta: number): Promise<void> {
  stage.viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true }));
  stage.viewport.scrollTop += delta;
  await painted();
}

async function wheelUntil(found: () => boolean, delta = -300, limit = 60): Promise<void> {
  for (let count = 0; count < limit && !found(); count += 1) await wheel(delta);
}

async function holds(rule: string, element: Element, frames: number): Promise<void> {
  const top = measureTop(element);
  await streamFrames(frames, (frame) => {
    checkFrame(frame);
    expectRule(rule, near(measureTop(element), top), `${frame}: ${moved(element, top)}`);
    expectRule("19", element.isConnected, `${frame}: the observed element left the DOM`);
  });
}

async function toEnd(): Promise<void> {
  stage.dock.querySelector<HTMLButtonElement>("button[aria-label='Scroll to bottom']")?.click();
  await painted();
}

async function openEditor(row: HTMLElement): Promise<void> {
  row.querySelector<HTMLElement>("[data-composer-readonly]")?.click();
  await until(() => row.querySelector("[contenteditable='true']") !== null, "the editor");
  await painted();
}

async function firstPaintedRows(container: HTMLElement): Promise<Stage> {
  await until(() => container.querySelector("[data-composer-region]") !== null, "the composer");

  for (;;) {
    await painted();
    const viewport = container.querySelector<HTMLElement>("[aria-label='Messages']");
    const log = container.querySelector<HTMLElement>("[aria-label='Messages'] > div");
    const dock = container.querySelector<HTMLElement>("[data-composer-region]")?.parentElement;

    if (
      viewport &&
      log &&
      dock &&
      log.querySelector("[data-row-key]:not([data-row-key='row:skeleton'])")
    )
      return { viewport, log, dock };
  }
}

async function type(text: string): Promise<void> {
  const draft = stage.dock.querySelector<HTMLElement>("[aria-multiline][aria-label='Message']");

  if (draft === null) throw new Error("The composer has no editor");
  draft.focus();
  window.getSelection()?.collapse(draft, draft.childNodes.length);
  await painted();
  document.execCommand("insertText", false, text);
  await painted();
}

const near = (value: number, target: number): boolean => Math.abs(value - target) <= 1;

const moved = (element: Element, top: number): string =>
  `moved from ${String(top)} to ${String(measureTop(element))}`;

function first<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null)
    throw new Error(`${what} is missing at ${step}\n${failures.join("\n")}`);

  return value;
}

export function run(): Promise<string> {
  const watchdog = new Promise<string>((resolve) =>
    window.setTimeout(() => resolve(`timed out at ${step}\n${failures.join("\n")}`), 35_000),
  );

  return Promise.race([checkRules(), watchdog]);
}

async function checkRules(): Promise<string> {
  queryClient.clear();
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:900px;height:700px";
  document.body.append(container);
  let root = mount(container);

  try {
    stage = await firstPaintedRows(container);
    checkFollowing("initial");
    expectRule("window", listRows().length < TURNS, "a long thread renders every row");

    step = "7, 12";

    const editable = first(
      visible("[data-sticky-user-message]").findLast(
        (row) => row.querySelector("[data-composer-readonly]") !== null && measureTop(row) > 100,
      ),
      "an editable message below the top edge",
    );

    await openEditor(editable);
    await holds("7/12", editable, 6);
    expectRule(
      "19",
      editable.querySelector("[contenteditable='true']") !== null,
      "live deltas closed the edit",
    );
    editable
      .querySelector("[contenteditable='true']")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(
      () => editable.querySelector("[contenteditable='true']") === null,
      "the edit to close",
    );
    await painted();
    expectRule("7", distance() > 1, "cancelling an edit returned to the end");

    step = "6, 11";
    await toEnd();
    const trigger = first(visible("[aria-expanded='false']")[0], "a closed disclosure at the end");
    const triggerTop = measureTop(trigger);
    trigger.click();
    await painted();
    checkFrame("expanded");
    expectRule(
      "6/11",
      near(measureTop(trigger), triggerTop),
      `expanding ${moved(trigger, triggerTop)}`,
    );
    await holds("6/9", trigger, 3);
    trigger.click();
    await painted();
    checkFrame("collapsed");
    expectRule(
      "6/11",
      near(measureTop(trigger), triggerTop),
      `collapsing ${moved(trigger, triggerTop)}`,
    );

    step = "3, 1-4, 17";
    await toEnd();

    const latest = first(
      Array.from(stage.log.querySelectorAll<HTMLElement>("[data-sticky-user-message]")).at(-1),
      "the latest prompt",
    );

    for (let frame = 0; frame < 8; frame += 1) {
      const top = measureTop(latest);
      const scrolled = stage.viewport.scrollTop;
      await streamFrames(1, checkFollowing);
      const rise = top - measureTop(latest);
      expectRule(
        "17",
        rise >= -1 && rise <= stage.viewport.scrollTop - scrolled + 1,
        `the latest prompt jumped from ${String(top)} to ${String(measureTop(latest))}`,
      );
    }

    expectRule(
      "17",
      Math.abs(measureTop(latest)) <= 2 && latest.dataset.stickyActive === "true",
      `the latest prompt sits at ${String(measureTop(latest))} at the end`,
    );

    step = "8";

    const paragraph = first(
      visible(PROSE).find((block) => measureTop(block) > 100),
      "visible prose",
    );

    const selected = first(paragraph.closest<HTMLElement>("[data-row-key]"), "the prose's row");
    window.getSelection()?.setBaseAndExtent(paragraph, 0, paragraph, paragraph.childNodes.length);
    await painted();
    await holds("8", selected, 4);
    window.getSelection()?.removeAllRanges();
    await wheel(stage.viewport.scrollHeight);
    await streamFrames(2, checkFollowing);

    step = "5, 9, 10";
    await toEnd();
    await wheel(-250);
    await holds("5/9", first(visible(PROSE)[0], "visible prose"), 6);

    const rowAbove = (): HTMLElement | undefined =>
      listRows().find(
        (row) =>
          answerIndex(row) !== undefined &&
          measureTop(row) + row.getBoundingClientRect().height < 0,
      );

    await wheelUntil(() => rowAbove() !== undefined);

    const aboveIndex = first(
      answerIndex(first(rowAbove(), "an answer above the anchor")),
      "its turn",
    );

    const held = first(visible(PROSE)[0], "visible prose");
    const heldTop = measureTop(held);

    const grow = async (index: number): Promise<void> => {
      const grown = view(liveText);
      const grownId = asId<"message">(`answer-${String(index)}`);
      stream.push({
        ...grown,
        messages: grown.messages.map((message) =>
          message.id === grownId
            ? prose(
                `answer-${String(index)}`,
                index,
                `${paragraphs(index)}\n\n${sentence.repeat(12)}`,
              )
            : message,
        ),
      });
      await painted();
    };

    await grow(aboveIndex);
    checkFrame("row above grew");
    expectRule("10", near(measureTop(held), heldTop), `a row above grew: ${moved(held, heldTop)}`);

    const spanning = (): HTMLElement | undefined =>
      listRows().find(
        (row) =>
          answerIndex(row) !== undefined &&
          measureTop(row) < 0 &&
          measureTop(row) + row.getBoundingClientRect().height > 0,
      );

    const lowerProse = (): HTMLElement | undefined =>
      visible(PROSE).find((block) => block.closest("[data-row-key]") !== spanning());

    await wheelUntil(() => spanning() !== undefined && lowerProse() !== undefined, -150);
    const spanningRow = first(spanning(), "a row spanning the top edge");
    const lower = first(lowerProse(), "prose below the spanning row");
    window.getSelection()?.setBaseAndExtent(lower, 0, lower, lower.childNodes.length);
    await painted();
    const lowerTop = measureTop(lower);
    await grow(first(answerIndex(spanningRow), "the spanning answer's turn"));
    checkFrame("spanning row grew while held");
    expectRule(
      "10/11",
      near(measureTop(lower), lowerTop),
      `the spanning row grew under a hold: ${moved(lower, lowerTop)}`,
    );
    window.getSelection()?.removeAllRanges();

    step = "16, 18";

    const reading = (): HTMLElement | undefined =>
      listRows().find(
        (row) =>
          answerIndex(row) !== undefined &&
          answerIndex(row) !== TALL_PROMPT &&
          measureTop(row) < -20 &&
          measureTop(row) + row.getBoundingClientRect().height > 40,
      );

    await wheelUntil(() => reading() !== undefined, -50);
    const readIndex = first(answerIndex(first(reading(), "an answer being read")), "its turn");

    const stuck = stage.log.querySelector<HTMLElement>(
      `[data-row-key='prompt:prompt-${String(readIndex)}'] [data-sticky-user-message]`,
    );

    expectRule(
      "16",
      stuck !== null && Math.abs(measureTop(stuck)) <= 2 && stuck.dataset.stickyActive === "true",
      "the prompt of the turn being read is not stuck at the top",
    );

    const tallRow = (): HTMLElement | null =>
      stage.log.querySelector(`[data-row-key='prompt:prompt-${String(TALL_PROMPT)}']`);

    await wheelUntil(() => tallRow() !== null, -400, 80);

    const tall = first(
      tallRow()?.querySelector<HTMLElement>("[data-sticky-user-message]"),
      "the tall prompt",
    );

    await openEditor(tall);
    container.style.height = "220px";
    await painted();
    expectRule(
      "18",
      tall.getBoundingClientRect().height > stage.viewport.clientHeight,
      "the tall prompt's editor fits the viewport",
    );
    await wheelUntil(() => measureTop(tall) <= -200, 100, 20);
    expectRule(
      "18",
      tall.dataset.stickyDisabled === "true" && measureTop(tall) < -100,
      `a tall prompt sticks at ${String(measureTop(tall))}`,
    );
    container.style.height = "700px";
    await painted();

    step = "21";
    await toEnd();
    await wheel(-600);
    const nearEnd = first(visible(PROSE)[0], "visible prose above the end");
    const nearEndTop = measureTop(nearEnd);

    for (const height of ["850px", "700px"]) {
      container.style.height = height;
      await painted();
      checkFrame(`${height} viewport while reading`);
      expectRule(
        "21",
        near(measureTop(nearEnd), nearEndTop),
        `${height}: ${moved(nearEnd, nearEndTop)}`,
      );
    }

    await toEnd();

    for (let frame = 0; frame < 4; frame += 1) await painted();

    for (const height of ["560px", "700px"]) {
      container.style.height = height;
      await painted();
      checkFollowing(`${height} viewport while following`);
    }

    step = "15";
    await wheel(-200);
    const anchored = first(visible(PROSE)[0], "visible prose");
    const anchoredTop = measureTop(anchored);
    const dockHeight = stage.dock.getBoundingClientRect().height;
    await type(sentence.repeat(4));
    await until(
      () => stage.dock.getBoundingClientRect().height > dockHeight,
      "the composer to grow",
    );
    await painted();
    checkFrame("composer grew while reading");
    expectRule(
      "15",
      near(measureTop(anchored), anchoredTop),
      `composer grew: ${moved(anchored, anchoredTop)}`,
    );
    await toEnd();
    await type(sentence.repeat(4));
    await painted();
    checkFollowing("composer grew while following");

    step = "2";
    await wheel(-300);
    expectRule("2", distance() > 60, "the wheel did not leave the end before sending");
    stage.dock.querySelector<HTMLButtonElement>("button[aria-label='Send message']")?.click();
    await until(() => sends.length > 0, "the send");
    await painted();
    await painted();
    checkFollowing("after sending");

    step = "25";
    await wheel(-30);
    expectRule("25", !buttonShown(), "the button shows within 60px");
    await wheel(-100);
    expectRule("25", buttonShown(), "the button hides past 60px");

    step = "20, 24";
    await wheel(-900);

    const kept = first(visible(PROSE)[0]?.closest<HTMLElement>("[data-row-key]"), "a visible row");

    const keptId = kept.dataset.rowKey;
    const keptTop = measureTop(kept);
    flushSync(() => root.unmount());
    root = mount(container);
    stage = await firstPaintedRows(container);
    const restored = listRows().find((row) => row.dataset.rowKey === keptId);
    expectRule(
      "20/24",
      restored !== undefined && near(measureTop(restored), keptTop),
      `${keptId ?? ""} reopened ${restored === undefined ? "nowhere" : moved(restored, keptTop)}`,
    );
    checkFrame("after remount");
    await streamFrames(2, checkFrame);
    await toEnd();
    flushSync(() => root.unmount());
    root = mount(container);
    stage = await firstPaintedRows(container);
    checkFollowing("reopened at the end");

    step = "19";

    const action: UserMessage = {
      ...user("action-1", TURNS, "Instructions for the selected Git action.", "steer"),
      source: { kind: "action", label: "Pending prompt" },
      turn: asId<"turn">("pending:action-1"),
      status: { kind: "pending", schedule: { kind: "joined", run: liveRun.id }, covered: true },
    };

    stream.push(view(liveText, [action]));
    await until(
      () => listRows().some((row) => row.dataset.rowKey === "prompt:action-1"),
      "the prompt row",
    );
    await painted();
    checkFollowing("prompt row");

    const promptRow = first(
      listRows().find((row) => row.dataset.rowKey === "prompt:action-1"),
      "the prompt row",
    );

    await wheel(-300);
    const beforePrompt = first(visible(PROSE)[0], "visible prose");
    const beforePromptTop = measureTop(beforePrompt);
    const landedTurn = asId<"turn">("landed");

    const landed: UserMessage = {
      ...action,
      turn: landedTurn,
      status: {
        kind: "landed",
        commit: asId<"commit">("action-1"),
        run: liveRun.id,
        replaced: null,
      },
    };

    stream.push(
      view(
        liveText,
        [landed],
        [
          endedTurn([], {
            id: landedTurn,
            prompt: landed.id,
            state: { kind: "working", activity: null },
          }).info,
        ],
      ),
    );
    await until(
      () => promptRow.firstElementChild?.getAttribute("title") === null,
      "the prompt to settle",
    );
    await painted();
    checkFrame("landed");
    expectRule("9", near(measureTop(beforePrompt), beforePromptTop), "a prompt moved the view");
    expectRule(
      "19",
      promptRow.isConnected && promptRow.textContent?.includes("Pending prompt") === true,
      "the landed message replaced its row",
    );
    expectRule(
      "19",
      !promptRow.textContent?.includes("Instructions for") &&
        !Array.from(promptRow.querySelectorAll("button")).some(
          (control) => control.textContent?.trim() === "Edit Message",
        ),
      "an action message became editable or showed its instructions",
    );

    return failures.length === 0 ? "passed" : failures.join("\n");
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

applyDisplayMode("light");
