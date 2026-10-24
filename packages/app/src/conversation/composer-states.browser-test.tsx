import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type {
  Delivery,
  Execution,
  HeldMessage,
  Message,
  MessageId,
  ModelCatalogView,
  PartView,
  QueuedMessage,
  ReleaseOutcome,
  ReviseOutcome,
  RunView,
  SessionView,
  UserContent,
} from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import type { HostState } from "../nyte.ts";
import type { ComposerViewState } from "../layout/session-view-state.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import { SessionDndProvider } from "../layout/session-dnd.tsx";
import { keys, queryClient, useSessionView } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { SessionScreen } from "../screens/session-screen.tsx";
import { createAppRouter } from "../router.tsx";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { scriptedConnection } from "../../test/scripted-connection.ts";
import { COMPLETED, USAGE, endedTurn, sessionRow } from "../../test/view-fixtures.ts";
import { Composer } from "./composer.tsx";
import { conversationMessages } from "./transcript-rows.ts";

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

const turn = asId<"turn">("turn");

const DRAFT =
  "Rename the session store to journal, keep the old export for one release, and update every caller in the desktop package before touching the docs.";

const prompt: Message = {
  id: asId<"message">("prompt"),
  turn,
  at: 1,
  kind: "user",
  content: "Where does the session store live?",
  source: { kind: "user" },
  delivery: "queue",
  status: { kind: "landed", commit: asId<"commit">("prompt"), run: null, replaced: null },
  siblings: { index: 0, count: 1, ids: [] },
};

const reply: Message = {
  id: asId<"message">("reply"),
  turn,
  at: 2,
  kind: "part",
  part: asId<"part">("reply"),
  partKind: "text",
  role: "answer",
  state: {
    markdown: "In `packages/core/src/store.ts`, behind the `Store` interface.",
    signature: null,
  },
  version: 1,
  status: { kind: "settled", commit: asId<"commit">("reply"), endedAt: 2 },
};

const live = (stopping = false): Execution => ({
  kind: "live",
  run: liveRun,
  phase: "responding",
  stopping,
});

function view(
  execution: Execution,
  queue: readonly QueuedMessage[] = [],
  parts: readonly PartView[] = [],
): SessionView {
  const busy = execution.kind !== "idle";

  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(1),
    activation: { kind: "active" },
    messages: [prompt, reply],
    queue,
    leadingPrompt: null,
    parts,
    turns: [
      endedTurn([], {
        id: turn,
        prompt: prompt.id,
        run: busy ? liveRun.id : null,
        steps: 1,
        ...(busy && { state: { kind: "working", activity: null } }),
      }).info,
    ],
    usage: USAGE,
    execution,
    reportsHeld: false,
    background: [],
    configuration: { selected: liveRun.configuration, effective: liveRun.configuration },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

function queued(
  id: string,
  content: string,
  status: QueuedMessage["status"] = {
    kind: "pending",
    schedule: { kind: "next-turn", reason: "requested" },
    covered: true,
  },
): QueuedMessage {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">(`loose:${id}`),
    at: 1,
    kind: "user",
    content,
    source: { kind: "user" },
    delivery: "queue",
    status,
    siblings: { index: 0, count: 1, ids: [] },
  };
}

const question: PartView = {
  id: asId<"part">("question"),
  partKind: "ask/question",
  placement: { kind: "modal" },
  state: {
    questions: [
      {
        header: "Exports",
        question: "Keep the old export?",
        options: [
          { label: "Yes, for one release", description: "Keep callers working during migration." },
          { label: "No, remove it", description: "Migrate every caller now." },
        ],
      },
      {
        header: "Clients",
        question: "Which clients should change?",
        options: [
          { label: "Desktop", description: "Update the Electron question dock." },
          { label: "Web", description: "Use the same flow in the browser." },
          { label: "Mobile", description: "Keep native answer controls." },
        ],
        multiple: true,
      },
    ],
    answers: null,
  },
  version: 1,
  status: { kind: "live", run: liveRun.id },
  owner: "question",
};

interface Probe {
  readonly layer: Layer;
  readonly region: HTMLElement;
  readonly editor: HTMLElement;
  readonly button: (name: string) => HTMLButtonElement | null;
}

const inert = (button: HTMLButtonElement | null): boolean =>
  button !== null && (button.disabled || button.getAttribute("aria-disabled") === "true");

interface ComposerState {
  readonly name: string;
  readonly view: SessionView | undefined;
  readonly draft?: string;
  readonly check: (probe: Probe) => readonly string[] | Promise<readonly string[]>;
}

const QUEUED_TEXT = "Then run the tests.";

const KEPT_DRAFT = "Keep this draft.";

let saveOutcome: ReviseOutcome["kind"] = "revised";

const saves: { readonly content: UserContent; readonly delivery: Delivery | undefined }[] = [];

const calls: string[] = [];

const holdAnswers: ("sent" | "missing")[] = [];

const saveGates: Promise<void>[] = [];

let loseHold: (lost: Awaited<HeldMessage["lost"]>) => void = () => undefined;

let stored: ComposerViewState | undefined;

function heldMessage(message: MessageId): HeldMessage {
  const lost = Promise.withResolvers<Awaited<HeldMessage["lost"]>>();
  let released = false;

  const release = async (): Promise<ReleaseOutcome> => {
    if (!released) calls.push(`release ${message}`);
    released = true;

    return { kind: "released" };
  };

  loseHold = lost.resolve;

  return {
    kind: "held",
    message,
    lost: lost.promise,
    save: async (content, options) => {
      calls.push(`save ${message}`);
      saves.push({ content, delivery: options?.delivery });
      await saveGates.shift();
      released = true;

      return { kind: saveOutcome };
    },
    release,
    async [Symbol.asyncDispose]() {
      await release();
    },
  };
}

async function editQueuedMessage({
  layer,
  region,
  editor,
  button,
}: Probe): Promise<readonly string[]> {
  const failures: string[] = [];

  const check = (ok: boolean, failure: string): void => {
    if (!ok) failures.push(failure);
  };

  const editButton = (row: string) =>
    region.querySelector<HTMLButtonElement>(
      `[data-queue-row='${row}'] button[aria-label='Edit queued message']`,
    );

  const indicator = () => region.querySelector("[data-composer-frame] [role='status']");

  const reads = (text: string) =>
    until(
      () => (editor.innerText === text ? true : null),
      `the composer to read "${text}"`,
      () => `; it reads "${editor.innerText}"`,
    );

  const press = (key: string): void => {
    editor.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  };

  const beginEdit = async (): Promise<void> => {
    editButton("first")?.click();
    await reads(QUEUED_TEXT);
  };

  const type = async (text: string): Promise<void> => {
    const typed = `${editor.innerText}${text}`;
    document.execCommand("insertText", false, text);
    await reads(typed);
  };

  const called = (from: number, call: string, after: string) =>
    until(() => (calls.slice(from).includes(call) ? true : null), `"${call}" after ${after}`);

  const notice = () => region.querySelector("[role='alert']")?.textContent;

  saveOutcome = "revised";
  holdAnswers.length = 0;

  let mark = calls.length;
  await beginEdit();
  await called(mark, "hold first", "Edit");
  check(indicator()?.textContent === "Editing queued message", "no editing indicator");
  check(
    region.querySelector("[data-queue-row='first']")?.getAttribute("data-editing") === "true",
    "the edited row is not marked",
  );
  check(
    inert(editButton("second")) &&
      editButton("second")?.title === "Finish editing the queued message first.",
    "another row's Edit is open during an edit",
  );
  const sendTitle = button("Send message")?.title ?? "";
  check(
    sendTitle === "Update (Enter) · Steer Instead (Ctrl+Enter)",
    `send button reads "${sendTitle}"`,
  );

  if (layer === "composer")
    check(
      stored?.draft === `${QUEUED_TEXT}\n${KEPT_DRAFT}`,
      `the composer stores "${stored?.draft ?? ""}" while editing`,
    );

  mark = calls.length;
  press("Escape");
  await reads(KEPT_DRAFT);
  check(indicator() === null, "the indicator outlives Esc");
  await called(mark, "release first", "Esc");

  await beginEdit();
  mark = calls.length;
  button("Cancel editing")?.click();
  await reads(KEPT_DRAFT);
  await called(mark, "release first", "Cancel editing");

  await beginEdit();
  await type(" Then lint.");
  let finishSave: () => void = () => undefined;
  saveGates.push(
    new Promise<void>((resolve) => {
      finishSave = resolve;
    }),
  );
  press("Enter");
  await until(
    () => (button("Send message")?.getAttribute("aria-busy") === "true" ? true : null),
    "the save to start",
  );
  document.execCommand("insertText", false, " Typed while saving.");

  for (const target of [
    region.querySelector("[data-composer-frame]"),
    layer === "session" ? document.querySelector("[aria-label='Messages']") : null,
  ]) {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" }),
    );
    target?.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  }

  await painted();
  await painted();
  await painted();
  check(
    editor.innerText === `${QUEUED_TEXT} Then lint.`,
    `typing while saving changed the edit to "${editor.innerText}"`,
  );
  check(
    region.querySelector("[aria-label='Image attachments']") === null,
    "a file dropped while saving was attached",
  );
  finishSave();
  await reads(KEPT_DRAFT);
  check(document.activeElement === editor, "the composer lost focus after saving");
  const saved = saves.at(-1);
  check(
    saved?.content === `${QUEUED_TEXT} Then lint.` && saved.delivery === "queue",
    "saving did not revise the queued message",
  );

  saveOutcome = "sent";
  const beforeSave = editor.innerText;
  await beginEdit();
  await type(" Then push.");
  press("Enter");
  await reads(`${QUEUED_TEXT} Then push.\n${beforeSave}`);
  check(notice() === "That message was already sent.", "no notice that the save found it sent");

  saveOutcome = "revised";
  const beforeLost = editor.innerText;
  await beginEdit();
  await type(" Then deploy.");
  loseHold({ kind: "sent" });
  await reads(`${QUEUED_TEXT} Then deploy.\n${beforeLost}`);
  check(notice() === "That message was already sent.", "no notice when the hold was lost");

  const beforeImage = editor.innerText;
  await beginEdit();
  const transfer = new DataTransfer();
  transfer.items.add(
    new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" }),
  );
  region
    .querySelector("[data-composer-frame]")
    ?.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  await until(
    () => region.querySelector("[aria-label='Image attachments']"),
    "the dropped image to attach",
  );
  loseHold({ kind: "lapsed" });
  await until(
    () => (notice() === "Couldn't keep the message on hold." ? true : null),
    "the lapsed notice",
  );
  check(
    editor.innerText === `${QUEUED_TEXT}\n${beforeImage}` &&
      region.querySelector("[aria-label='Image attachments']") !== null,
    `an edit with an added image ended as "${editor.innerText}"`,
  );

  for (const [answer, shown] of [
    ["missing", "That message is no longer queued."],
    ["sent", "That message was already sent."],
  ] as const) {
    holdAnswers.push(answer);
    const beforeHold = editor.innerText;
    mark = calls.length;
    editButton("first")?.click();
    await called(mark, "hold first", "Edit");
    await until(() => (notice() === shown ? true : null), `the notice "${shown}"`);
    check(
      editor.innerText === beforeHold && indicator() === null,
      `an unchanged edit of a ${answer} message left "${editor.innerText}"`,
    );
  }

  const sendNow = () =>
    region.querySelector<HTMLButtonElement>(
      "[data-queue-row='second'] button[aria-label='Add to next response']",
    );

  mark = calls.length;
  sendNow()?.click();
  await called(mark, "revise second", "Send now");
  await until(sendNow, "the revised row to leave its sending state");

  return failures;
}

const STATES: readonly ComposerState[] = [
  {
    name: "idle",
    view: view(COMPLETED),
    check: ({ editor, button }) => [
      ...(editor.dataset.placeholder === "Add a follow-up"
        ? []
        : ["placeholder is not the follow-up prompt"]),
      ...(inert(button("Send message")) ? [] : ["Send is live with nothing to send"]),
      ...(button("Stop response") === null ? [] : ["Stop shows with no run"]),
    ],
  },
  {
    name: "draft",
    view: view(COMPLETED),
    draft: DRAFT,
    check: ({ editor, button }) => [
      ...(editor.textContent === DRAFT ? [] : [`editor reads "${editor.textContent ?? ""}"`]),
      ...(button("Send message") !== null && !inert(button("Send message"))
        ? []
        : ["Send is not live"]),
    ],
  },
  {
    name: "working",
    view: view(live()),
    check: ({ button }) => [
      ...(button("Stop response") !== null && !inert(button("Stop response"))
        ? []
        : ["Stop is not live"]),
      ...(button("Send message") === null ? [] : ["Send shows beside Stop with nothing to send"]),
    ],
  },
  {
    name: "stopping",
    view: view(live(true)),
    check: ({ button }) =>
      button("Stop response")?.getAttribute("aria-busy") === "true"
        ? []
        : ["Stop does not show it is stopping"],
  },
  {
    name: "queued",
    view: view(live(), [
      queued("first", "Then run the tests."),
      queued("second", "And open a PR."),
    ]),
    check: ({ region }) => {
      const section = region.querySelector("section[aria-label='Queued messages']");

      return [
        ...(section?.textContent?.startsWith("2 queued messages") === true
          ? []
          : ["queue header does not count 2"]),
        ...(section?.querySelectorAll("[role='listitem']").length === 2
          ? []
          : ["queue does not list 2 rows"]),
      ];
    },
  },
  {
    name: "queued-edit",
    view: view(live(), [queued("first", QUEUED_TEXT), queued("second", "And open a PR.")]),
    draft: KEPT_DRAFT,
    check: editQueuedMessage,
  },
  {
    name: "unsent",
    view: view(COMPLETED, [
      queued("offline", "Push the branch.", {
        kind: "unsent",
        attempts: 2,
        retrying: { at: 0, reason: "offline" },
      }),
    ]),
    check: ({ region }) => {
      const row = region.querySelector("[data-queue-row='offline']");

      const buttons = Array.from(row?.querySelectorAll("button") ?? [], (button) =>
        button.getAttribute("aria-label"),
      ).join(", ");

      const shortcuts = row?.getAttribute("aria-keyshortcuts") ?? "";

      return [
        ...(Array.from(region.querySelectorAll("[role='alert']")).some(
          (alert) => alert.textContent === "Couldn't send: offline. Retrying…",
        )
          ? []
          : ["no retry alert"]),
        ...(buttons === "Remove queued message" ? [] : [`the unsent row offers "${buttons}"`]),
        ...(shortcuts === "ArrowUp ArrowDown Escape Control+Delete"
          ? []
          : [`the unsent row advertises "${shortcuts}"`]),
      ];
    },
  },
  {
    name: "question",
    view: view(live(), [], [question]),
    draft: "Yes, for one release.",
    check: ({ editor, button }) => [
      ...(editor.dataset.placeholder === "Answer in your own words"
        ? []
        : ["placeholder does not ask for an answer"]),
      ...(button("Send answer") !== null && !inert(button("Send answer"))
        ? []
        : ["Send answer is not live"]),
    ],
  },
  {
    name: "loading",
    view: undefined,
    check: ({ editor, button }) => [
      ...(editor.getAttribute("aria-disabled") === "true"
        ? ["editor refuses input before the view"]
        : []),
      ...(inert(button("Add to message")) ? ["Add is dead before the view"] : []),
    ],
  },
];

const LAYERS = ["composer", "session"] as const;

type Layer = (typeof LAYERS)[number];

const WIDTH_NAMES = ["wide", "narrow"] as const;

type Width = (typeof WIDTH_NAMES)[number];

const WIDTHS = { wide: 760, narrow: 340 } satisfies Record<Width, number>;

const HEIGHT = 560;

const stateSession = (state: ComposerState) => asId<"session">(`composer-${state.name}`);

installConnection(
  scriptedConnection({
    sessions: STATES.map((state) =>
      sessionRow(stateSession(state), { name: `Composer ${state.name}` }),
    ),
    views: new Map(
      STATES.map((state) => [stateSession(state), state.view === undefined ? [] : [state.view]]),
    ),
    session: () => ({
      hold: async (message) => {
        calls.push(`hold ${message}`);
        const answer = holdAnswers.shift();

        return answer === undefined ? heldMessage(message) : { kind: answer };
      },
      revise: async (message) => {
        calls.push(`revise ${message}`);

        return { kind: "revised" };
      },
    }),
  }).connection,
);

function seedQueries(): void {
  queryClient.setQueryData(keys.host, {
    workspace: undefined,
  } satisfies HostState);
  queryClient.setQueryData(keys.modelCatalog("initial"), {
    generation: asId<"catalog-generation">("initial"),
    providers: [],
    default: { provider: "test", id: "test" },
  } satisfies ModelCatalogView);
  queryClient.setQueryData(keys.mentionFiles, []);
}

function LoneComposer({ state }: { readonly state: ComposerState }): ReactElement {
  const sessionId = stateSession(state);
  const sessionView = useSessionView(sessionId);
  const messages = conversationMessages(sessionView);

  return (
    <Composer
      sessionId={sessionId}
      execution={sessionView?.execution}
      pending={messages.queued}
      unsent={messages.unsent}
      onViewStateChange={(state) => {
        stored = state;
      }}
    />
  );
}

let mounts = 0;

function Stage({
  state,
  layer,
}: {
  readonly state: ComposerState;
  readonly layer: Layer;
}): ReactElement {
  const [router] = useState(() =>
    createAppRouter({
      history: createMemoryHistory({ initialEntries: [`/session/${stateSession(state)}`] }),
    }),
  );

  const [panes] = useState(() => {
    const controller = new PaneController({
      storageKey: `composer-states-${String((mounts += 1))}`,
    });
    controller.selectSession(stateSession(state));

    return controller;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <TooltipProvider delay={0} closeDelay={0} timeout={0}>
          <PaneControllerProvider controller={panes}>
            <SessionDndProvider>
              {layer === "composer" ? <LoneComposer state={state} /> : <SessionScreen />}
            </SessionDndProvider>
          </PaneControllerProvider>
        </TooltipProvider>
      </RouterContextProvider>
    </QueryClientProvider>
  );
}

function stageStyle(layer: Layer, width: Width): string {
  const base = `position:relative;display:flex;flex-direction:column;width:${String(WIDTHS[width])}px;height:${String(HEIGHT)}px;flex-shrink:0;`;

  return layer === "composer" ? `${base}justify-content:flex-end;outline:1px dashed #8884;` : base;
}

let renderFailure: unknown;

async function until<T>(
  read: () => T | null | undefined,
  what: string,
  seen: () => string = () => "",
): Promise<T> {
  const deadline = performance.now() + 5_000;

  for (;;) {
    if (renderFailure !== undefined) throw renderFailure;
    const value = read();

    if (value !== null && value !== undefined) return value;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}${seen()}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

async function show(host: HTMLElement, state: ComposerState, layer: Layer, width: Width) {
  const stage = document.createElement("div");
  stage.style.cssText = stageStyle(layer, width);
  host.replaceChildren(stage);
  renderFailure = undefined;

  const root = createRoot(stage, {
    onUncaughtError: (error) => {
      renderFailure = error;
    },
  });

  flushSync(() => root.render(<Stage state={state} layer={layer} />));

  const region = await until(
    () => stage.querySelector<HTMLElement>("[data-composer-region]"),
    "the composer",
  );

  const editor = await until(
    () => region.querySelector<HTMLElement>("[data-placeholder]"),
    "the editor",
  );

  if (state.view !== undefined)
    await until(
      () =>
        layer === "composer" ||
        stage.querySelector("[aria-label='Messages'] [data-row-key]") !== null
          ? true
          : null,
      "the transcript",
    );

  if (state.draft !== undefined) {
    await painted();
    editor.focus();
    document.execCommand("insertText", false, state.draft);
  }

  await painted();
  await painted();

  const probe: Probe = {
    layer,
    region,
    editor,
    button: (name) => region.querySelector<HTMLButtonElement>(`button[aria-label='${name}']`),
  };

  return { stage, root, probe };
}

function layoutFailures(stage: HTMLElement, region: HTMLElement): string[] {
  const bounds = stage.getBoundingClientRect();
  const frame = region.querySelector("[data-composer-frame]");

  if (frame === null) return ["no composer frame"];
  const failures: string[] = [];
  const rect = frame.getBoundingClientRect();

  if (rect.height === 0) failures.push("the frame has no height");

  for (const element of [
    frame,
    ...region.querySelectorAll("section, [role='alert'], [role='status']"),
  ]) {
    const box = element.getBoundingClientRect();

    if (box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5)
      failures.push(
        `${element.tagName.toLowerCase()} spills ${(box.right - bounds.right).toFixed(1)}px past the stage`,
      );

    if (box.top < bounds.top - 0.5)
      failures.push(`${element.tagName.toLowerCase()} rises above the stage`);
  }

  return failures;
}

export async function run(): Promise<string> {
  const failures: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);

  try {
    for (const state of STATES)
      for (const layer of LAYERS)
        for (const width of WIDTH_NAMES) {
          queryClient.clear();
          seedQueries();
          const label = `${state.name} · ${layer} · ${width}`;

          try {
            const { stage, root, probe } = await show(host, state, layer, width);

            for (const failure of [
              ...layoutFailures(stage, probe.region),
              ...(await state.check(probe)),
            ])
              failures.push(`${label}: ${failure}`);
            flushSync(() => root.unmount());
          } catch (error) {
            failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

    return failures.length === 0 ? "passed" : failures.join("\n");
  } finally {
    host.remove();
    queryClient.clear();
  }
}

const chip: CSSProperties = {
  font: "12px/1 system-ui",
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid #8886",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

const chipOn: CSSProperties = { ...chip, background: "#8884" };

interface Selection {
  readonly state: number;
  readonly layer: Layer;
  readonly width: Width;
}

function Controls({
  selection,
  failures,
  onSelect,
}: {
  readonly selection: Selection;
  readonly failures: readonly string[];
  readonly onSelect: (change: Partial<Selection>) => void;
}): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, font: "12px/1.4 system-ui" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {STATES.map((item, index) => (
          <button
            key={item.name}
            type="button"
            style={index === selection.state ? chipOn : chip}
            onClick={() => onSelect({ state: index })}
          >
            {String(index + 1)} {item.name}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {LAYERS.map((item) => (
          <button
            key={item}
            type="button"
            style={item === selection.layer ? chipOn : chip}
            onClick={() => onSelect({ layer: item })}
          >
            {item}
          </button>
        ))}
        <span style={{ width: 12 }} />
        {WIDTH_NAMES.map((item) => (
          <button
            key={item}
            type="button"
            style={item === selection.width ? chipOn : chip}
            onClick={() => onSelect({ width: item })}
          >
            {item} {String(WIDTHS[item])}px
          </button>
        ))}
        <span style={{ opacity: 0.6, alignSelf: "center" }}>
          1–{String(STATES.length)} or ←/→ state · L layer · W width
        </span>
      </div>
      <div
        role="status"
        style={{ minHeight: 18, color: failures.length === 0 ? "inherit" : "crimson" }}
      >
        {failures.length === 0 ? "Checks pass" : failures.join(" · ")}
      </div>
    </div>
  );
}

export function studio(): void {
  document.title = "Composer studio";
  document.body.style.cssText =
    "margin:0;padding:16px;display:flex;flex-direction:column;gap:16px;";
  const controls = createRoot(document.body.appendChild(document.createElement("div")));
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = "display:flex;justify-content:center;";
  let selection: Selection = { state: 0, layer: "composer", width: "wide" };
  let unmount = (): void => undefined;
  let generation = 0;

  const draw = (failures: readonly string[]): void =>
    controls.render(<Controls selection={selection} failures={failures} onSelect={select} />);

  function select(change: Partial<Selection>): void {
    selection = { ...selection, ...change };
    const state = STATES[selection.state];

    if (state === undefined) return;
    generation += 1;
    const current = generation;
    unmount();
    unmount = () => undefined;
    draw([]);
    queryClient.clear();
    seedQueries();
    void (async () => {
      try {
        const { stage, root, probe } = await show(host, state, selection.layer, selection.width);
        unmount = () => root.unmount();

        if (current !== generation) return unmount();
        draw([...layoutFailures(stage, probe.region), ...(await state.check(probe))]);
      } catch (error) {
        if (current === generation) draw([error instanceof Error ? error.message : String(error)]);
      }
    })();
  }

  window.addEventListener("keydown", (event) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("form, [contenteditable='true']") !== null
    )
      return;
    const digit = Number(event.key);
    const count = STATES.length;

    if (Number.isInteger(digit) && digit >= 1 && digit <= count) select({ state: digit - 1 });
    else if (event.key === "ArrowRight") select({ state: (selection.state + 1) % count });
    else if (event.key === "ArrowLeft") select({ state: (selection.state - 1 + count) % count });
    else if (event.key === "l")
      select({ layer: selection.layer === "composer" ? "session" : "composer" });
    else if (event.key === "w") select({ width: selection.width === "wide" ? "narrow" : "wide" });
  });
  select({});
}

applyDisplayMode("light");
