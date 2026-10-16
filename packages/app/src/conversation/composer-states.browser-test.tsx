import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type {
  Execution,
  Message,
  ModelCatalogView,
  PartView,
  RunView,
  SessionView,
} from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import type { HostState } from "../nyte.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import { SessionDndProvider } from "../layout/session-dnd.tsx";
import { keys, queryClient, useSessionView } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { ThreadScreen } from "../screens/thread.tsx";
import { createAppRouter } from "../router.tsx";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { scriptedConnection } from "../../test/scripted-connection.ts";
import { COMPLETED, endedTurn, sessionRow } from "../../test/view-fixtures.ts";
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

function user(
  id: string,
  content: string,
  status: Extract<Message, { readonly kind: "user" }>["status"],
): Message {
  return {
    id: asId<"message">(id),
    turn: status.kind === "landed" ? turn : asId<"turn">(`loose:${id}`),
    at: 1,
    kind: "user",
    content,
    source: { kind: "user" },
    delivery: "queue",
    status,
    siblings: { index: 0, count: 1, ids: [] },
  };
}

const prompt = user("prompt", "Where does the session store live?", {
  kind: "landed",
  commit: asId<"commit">("prompt"),
  run: null,
  replaced: null,
});

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
  extra: readonly Message[] = [],
  parts: readonly PartView[] = [],
): SessionView {
  const busy = execution.kind !== "idle";

  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(1),
    activation: { kind: "active" },
    messages: [prompt, reply, ...extra],
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
    execution,
    background: [],
    configuration: { selected: liveRun.configuration, effective: liveRun.configuration },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

const queued = (id: string, content: string): Message =>
  user(id, content, {
    kind: "pending",
    schedule: { kind: "next-turn", reason: "requested" },
    covered: true,
  });

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
  readonly check: (probe: Probe) => readonly string[];
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
    name: "unsent",
    view: view(COMPLETED, [
      user("offline", "Push the branch.", {
        kind: "unsent",
        attempts: 2,
        retrying: { at: 0, reason: "offline" },
      }),
    ]),
    check: ({ region }) =>
      Array.from(region.querySelectorAll("[role='alert']")).some(
        (alert) => alert.textContent === "Couldn't send: offline. Retrying…",
      )
        ? []
        : ["no retry alert"],
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

const LAYERS = ["composer", "thread"] as const;

type Layer = (typeof LAYERS)[number];

const WIDTH_NAMES = ["wide", "narrow"] as const;

type Width = (typeof WIDTH_NAMES)[number];

const WIDTHS = { wide: 760, narrow: 340 } satisfies Record<Width, number>;

const HEIGHT = 560;

const sessionOf = (state: ComposerState) => asId<"session">(`composer-${state.name}`);

installConnection(
  scriptedConnection({
    sessions: STATES.map((state) =>
      sessionRow(sessionOf(state), { name: `Composer ${state.name}` }),
    ),
    views: new Map(
      STATES.map((state) => [sessionOf(state), state.view === undefined ? [] : [state.view]]),
    ),
  }).connection,
);

function seedQueries(): void {
  queryClient.setQueryData(keys.host, {
    workspace: undefined,
    platform: "linux",
  } satisfies HostState);
  queryClient.setQueryData(keys.modelCatalog("initial"), {
    generation: asId<"catalog-generation">("initial"),
    providers: [],
    default: { provider: "test", id: "test" },
  } satisfies ModelCatalogView);
  queryClient.setQueryData(keys.mentionFiles, []);
}

function LoneComposer({ state }: { readonly state: ComposerState }): ReactElement {
  const sessionId = sessionOf(state);
  const sessionView = useSessionView(sessionId);
  const messages = conversationMessages(sessionView);

  return (
    <Composer
      sessionId={sessionId}
      execution={sessionView?.execution}
      pending={messages.queued}
      unsent={messages.unsent}
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
      history: createMemoryHistory({ initialEntries: [`/session/${sessionOf(state)}`] }),
    }),
  );

  const [panes] = useState(() => {
    const controller = new PaneController({
      storageKey: `composer-states-${String((mounts += 1))}`,
    });
    controller.selectSession(sessionOf(state));

    return controller;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <TooltipProvider delay={0} closeDelay={0} timeout={0}>
          <PaneControllerProvider controller={panes}>
            <SessionDndProvider>
              {layer === "composer" ? (
                <LoneComposer state={state} />
              ) : (
                <ThreadScreen />
              )}
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

async function until<T>(read: () => T | null | undefined, what: string): Promise<T> {
  const deadline = performance.now() + 5_000;

  for (;;) {
    if (renderFailure !== undefined) throw renderFailure;
    const value = read();

    if (value !== null && value !== undefined) return value;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
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
    () => stage.querySelector<HTMLElement>("[role='region'][aria-label='Conversation input']"),
    "the composer",
  );

  const editor = await until(
    () => region.querySelector<HTMLElement>("[data-placeholder]"),
    "the editor",
  );

  if (state.view !== undefined)
    await until(
      () =>
        layer === "composer" || stage.querySelector("[role='log'] [data-message-id]") !== null
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

            for (const failure of [...layoutFailures(stage, probe.region), ...state.check(probe)])
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
        draw([...layoutFailures(stage, probe.region), ...state.check(probe)]);
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
      select({ layer: selection.layer === "composer" ? "thread" : "composer" });
    else if (event.key === "w") select({ width: selection.width === "wide" ? "narrow" : "wide" });
  });
  select({});
}

applyDisplayMode("light");
