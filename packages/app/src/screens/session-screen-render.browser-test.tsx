import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ModelCatalogView, SessionView } from "@nyte-ai/sdk";
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
import { COMPLETED, endedTurn, sessionRow } from "../../test/view-fixtures.ts";
import {
  ID,
  TURNS,
  TALL_PROMPT,
  liveRun,
  turnId,
  user,
  prose,
  sentence,
  paragraphs,
  ended,
  view,
} from "./session-screen-render.fixtures.ts";
import type { UserMessage } from "./session-screen-render.fixtures.ts";

let liveText = "Streaming";

const stream = viewStream(view(liveText));

const refuse = async (): Promise<never> => {
  throw new Error("Not scripted.");
};

const sends: string[] = [];

const editLanding = Promise.withResolvers<Extract<UserMessage["status"], { kind: "landed" }>>();

const editRead = Promise.withResolvers<SessionView>();

const EDITED_MESSAGE = asId<"message">("footer-edited");

installConnection(
  scriptedConnection({
    sessions: [sessionRow("session-screen-render", { name: "Transcript rules" })],
    views: new Map([[ID, stream]]),
    session: () => ({
      view: () => editRead.promise,
      send: async (content, options) => {
        sends.push(JSON.stringify(content));

        return {
          id: asId<"receipt">("sent"),
          message:
            options?.replace === asId<"message">("footer-next")
              ? EDITED_MESSAGE
              : asId<"message">("sent"),
          status: refuse,
          settled: refuse,
          stop: refuse,
          landed: () => editLanding.promise,
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

async function frames(label: string, verify: () => void): Promise<void> {
  for (let frame = 0; frame < 4; frame += 1) {
    await painted();
    checkFrame(`${label} frame ${String(frame)}`);
    verify();
  }
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
    editable.querySelector("[contenteditable='true']")?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        keyCode: 27,
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(
      () => editable.querySelector("[contenteditable='true']") === null,
      "the edit to close",
    );
    await painted();
    expectRule("7", distance() > 1, "cancelling an edit returned to the end");

    step = "6, 11";
    await toEnd();
    await wheelUntil(() => visible("[aria-expanded='false']").length > 0, -150);
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

    step = "latest-turn footer";

    let reservation: number | undefined;

    const checkFooter = (footer: HTMLElement, cardVisible: boolean): void => {
      const height = footer.getBoundingClientRect().height;
      reservation ??= height;
      expectRule("footer", footer.isConnected, "the reserved footer was replaced");
      expectRule("footer", Math.abs(height - reservation) <= 0.5, "the footer changed height");
      expectRule(
        "footer",
        (footer.querySelector("section") !== null) === cardVisible,
        `the changes card should be ${cardVisible ? "visible" : "absent"}`,
      );
    };

    const completed: SessionView = {
      ...view(liveText, [landed], [endedTurn([], { id: landedTurn, prompt: landed.id }).info]),
      execution: COMPLETED,
      changes: Array.from({ length: 6 }, (_, index) => ({
        path: index === 0 ? "src/footer.ts" : `src/footer-${String(index)}.ts`,
        status: "modified",
        added: 3,
        removed: 1,
      })),
    };

    const settled: SessionView = {
      ...completed,
      turns: completed.turns.map((turn) => ({ ...turn, state: ended })),
      messages: completed.messages.map((message) =>
        message.id === asId<"message">("live-32") ? prose("live-32", TURNS, liveText) : message,
      ),
    };

    stream.push(settled);
    await toEnd();
    await until(
      () => stage.log.querySelector("[data-row-key='changes:action-1'] section") !== null,
      "the completed changes card",
    );

    const previousFooter = first(
      stage.log.querySelector<HTMLElement>("[data-row-key='changes:action-1']"),
      "the completed footer",
    );

    expectRule(
      "footer",
      previousFooter.textContent?.includes("footer.ts") === true,
      "the completed card has no changed file",
    );

    const pendingNext: UserMessage = {
      ...user("footer-next", TURNS + 1, "A new normal turn."),
      turn: asId<"turn">("pending:footer-next"),
      status: { kind: "pending", schedule: { kind: "next-turn", reason: "idle" }, covered: true },
    };

    stream.push({ ...settled, messages: [...settled.messages, pendingNext] });
    let reserved: HTMLElement | undefined;
    await frames("pending footer", () => {
      const next = stage.log.querySelector<HTMLElement>("[data-row-key='changes:footer-next']");

      if (next === null) return;
      reserved ??= next;
      checkFooter(reserved, false);
      expectRule("footer", !previousFooter.isConnected, "the previous turn retained its card");
    });
    const nextFooter = first(reserved, "the next turn's pending footer");

    const nextStatus = {
      kind: "landed",
      commit: asId<"commit">("footer-next"),
      run: liveRun.id,
      replaced: null,
    } satisfies Extract<UserMessage["status"], { kind: "landed" }>;

    const nextPrompt: UserMessage = {
      ...pendingNext,
      turn: turnId(TURNS + 1),
      status: nextStatus,
    };

    const workingNext: SessionView = {
      ...settled,
      messages: [...settled.messages, nextPrompt],
      turns: [
        ...settled.turns,
        endedTurn([], {
          id: nextPrompt.turn,
          prompt: nextPrompt.id,
          run: liveRun.id,
          state: { kind: "working", activity: null },
        }).info,
      ],
      execution: {
        kind: "live",
        run: { ...liveRun, origin: { kind: "input", message: nextPrompt.id } },
        phase: "responding",
        stopping: false,
      },
    };

    stream.push(workingNext);
    await frames("landed footer", () => checkFooter(nextFooter, false));

    const finishedNext: SessionView = {
      ...workingNext,
      execution: COMPLETED,
      messages: [
        ...workingNext.messages,
        prose("footer-answer", TURNS + 1, "The next turn is complete."),
      ],
      turns: workingNext.turns.map((turn) => ({ ...turn, state: ended })),
    };

    stream.push(finishedNext);
    await frames("completed footer", () => checkFooter(nextFooter, true));
    expectRule(
      "footer",
      nextFooter.textContent?.includes("footer.ts") === true,
      "completion did not fill the reserved footer",
    );
    stream.push({ ...finishedNext, changes: [] });
    await frames("empty footer", () => checkFooter(nextFooter, false));

    step = "edit submission before the host updates";
    stream.push(finishedNext);
    await toEnd();
    await until(() => nextFooter.querySelector("section") !== null, "the card before editing");

    const editRow = first(
      stage.log.querySelector<HTMLElement>(
        "[data-row-key='prompt:footer-next'] [data-sticky-user-message]",
      ),
      "the next turn's editable prompt",
    );

    await openEditor(editRow);
    const sentBeforeEdit = sends.length;
    first(
      editRow.querySelector<HTMLButtonElement>("button[aria-label='Send message']"),
      "the edit submit button",
    ).click();
    await frames("edit submitted", () => {
      if (sends.length === sentBeforeEdit) return;
      checkFooter(nextFooter, false);
    });
    expectRule(
      "footer",
      sends.length === sentBeforeEdit + 1,
      "the edited prompt was not submitted",
    );
    expectRule(
      "footer",
      editRow.querySelector("[aria-busy='true']") !== null,
      "the edit did not wait for its landing receipt",
    );

    const editedStatus = {
      ...nextStatus,
      commit: asId<"commit">("footer-edited"),
      replaced: { previous: nextPrompt.id, stopped: null },
    };

    editLanding.resolve(editedStatus);
    await frames("receipt before the fresh read", () => checkFooter(nextFooter, false));
    editRead.resolve({
      ...finishedNext,
      seq: asSeq(3),
      revision: asId<"revision">("fresh-edit-read"),
      messages: [],
      turns: [],
      leadingPrompt: null,
    });
    await frames("fresh read before the watched view", () => checkFooter(nextFooter, false));
    stream.push({ ...finishedNext, seq: asSeq(2), revision: asId<"revision">("unrelated-update") });
    await frames("older unrelated view after the receipt", () => checkFooter(nextFooter, false));
    expectRule(
      "footer",
      editRow.querySelector("[aria-busy='true']") !== null,
      "the edit stopped waiting before the watched view reached the fresh read",
    );

    const supersededPrompt = user("footer-superseded", TURNS + 2, "Another actor moved the head.");

    const supersededRun = {
      ...liveRun,
      id: asId<"run">("footer-superseded-run"),
      origin: { kind: "input", message: supersededPrompt.id } as const,
    };

    const supersededView: SessionView = {
      ...workingNext,
      seq: asSeq(4),
      revision: asId<"revision">("superseded-view"),
      messages: workingNext.messages.map((message) =>
        message.id === nextPrompt.id ? supersededPrompt : message,
      ),
      turns: workingNext.turns.map((turn) =>
        turn.id === nextPrompt.turn
          ? {
              ...turn,
              id: supersededPrompt.turn,
              prompt: supersededPrompt.id,
              run: supersededRun.id,
            }
          : turn,
      ),
      execution: {
        kind: "live",
        run: supersededRun,
        phase: "responding",
        stopping: false,
      },
    };

    stream.push(supersededView);
    let newerFooter: HTMLElement | undefined;
    await frames("newer coalesced view acknowledged", () => {
      const current = stage.log.querySelector<HTMLElement>(
        `[data-row-key='changes:${supersededPrompt.id}']`,
      );

      if (current === null) return;
      newerFooter ??= current;
      checkFooter(newerFooter, false);
      expectRule("footer", !nextFooter.isConnected, "the edit retained the replaced footer");
    });
    const acknowledged = first(newerFooter, "the newer turn's reserved footer");
    stream.push({
      ...supersededView,
      seq: asSeq(5),
      execution: COMPLETED,
      turns: supersededView.turns.map((turn) => ({ ...turn, state: ended })),
    });
    await frames("newer turn completed", () => checkFooter(acknowledged, true));

    return failures.length === 0 ? "passed" : failures.join("\n");
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

applyDisplayMode("light");
