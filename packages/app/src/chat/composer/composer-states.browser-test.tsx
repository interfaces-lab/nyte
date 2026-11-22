import { selectSession, tabPanes } from "../../../test/panes.ts";
import "../../../test/window-bridge.ts";
import { runStatus } from "@nyte-ai/plugin/client/presentation";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { SdkError } from "@nyte-ai/sdk";
import type { ModelCatalogView, StopOutcome } from "@nyte-ai/sdk";
import type { Chat } from "@nyte-ai/sdk/client";
import { asId } from "@nyte-ai/schema";
import type { HostState } from "../../contract/nyte.ts";
import type { TabPanes } from "../../tabs/window-store.ts";
import { PaneControllerProvider } from "../../panes/pane-context.tsx";
import { SessionDndProvider } from "../../panes/session-dnd.tsx";
import { keys, queryClient } from "../../data/query-client.ts";
import { useSessionView } from "../../data/sessions.ts";
import { SessionScreen } from "../../shell/session-screen.tsx";
import { createAppRouter } from "../../shell/routes.tsx";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../../theme/tokens.stylex.ts";
import "../../theme/global.css";
import { installScripted, scriptedConnection } from "../../../test/scripted-connection.ts";
import { COMPLETED, sessionRow } from "../../../test/view-fixtures.ts";
import { preferences } from "../../preferences/index.ts";
import { Composer } from "./composer.tsx";
import { persistedDraft } from "../../drafts/composer-draft.ts";
import { conversationMessages } from "../transcript/transcript-rows.ts";
import {
  DRAFT,
  KEPT_DRAFT,
  LAYERS,
  QUEUED_TEXT,
  calls,
  editQueuedMessage,
  expiredRow,
  failRender,
  health,
  heldMessage,
  holdAnswers,
  inert,
  live,
  painted,
  pressStop,
  question,
  queued,
  refuseSend,
  refusals,
  replayRefused,
  sendTwice,
  sends,
  stops,
  until,
  view,
} from "./composer-states.fixture.ts";
import type { ComposerState, Layer, Probe, SendEnding } from "./composer-states.fixture.ts";

type Delivered = Awaited<Awaited<ReturnType<Chat["send"]>>["delivered"]>;

const REFUSED = new SdkError("invalid", "The host refused the message.");

const STATES: readonly ComposerState[] = [
  {
    name: "idle",
    view: { ...view(COMPLETED), context: { tokens: 0, window: 0, lastRequest: null } },
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
    check: async ({ region, editor, button }) => {
      const steering = editor.dataset.placeholder;
      const footer = region.querySelector<HTMLElement>("[data-composer-footer]");
      preferences.runningMessage.set("queue");

      const queueing = await until(
        () => (editor.dataset.placeholder === steering ? null : editor.dataset.placeholder),
        "the placeholder to follow the setting",
      );

      preferences.runningMessage.set("steer");

      return [
        ...(button("Stop response") !== null && !inert(button("Stop response"))
          ? []
          : ["Stop is not live"]),
        ...(button("Send message") === null ? [] : ["Send shows beside Stop with nothing to send"]),
        ...(steering === "Steer without stopping" ? [] : [`steering placeholder is "${steering}"`]),
        ...(queueing === "Queue for next turn" ? [] : [`queueing placeholder is "${queueing}"`]),
        ...(footer?.offsetHeight === 26
          ? []
          : [`the footer is ${String(footer?.offsetHeight)} px, not 26`]),
      ];
    },
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
    name: "stop-pressed",
    view: view(live()),
    check: pressStop,
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
    name: "expired",
    view: view(COMPLETED, [
      queued("stale", "Push the branch.", {
        kind: "unsent",
        attempts: 0,
        retrying: { at: 0, reason: "it waited more than a day" },
      }),
    ]),
    expired: [asId<"message">("stale")],
    check: expiredRow,
  },
  {
    name: "sending",
    view: view(COMPLETED),
    check: sendTwice,
  },
  {
    name: "refused",
    view: view(live(), [queued("first", QUEUED_TEXT)]),
    check: refuseSend,
  },
  {
    name: "replayed",
    view: view(COMPLETED),
    check: replayRefused,
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

const WIDTH_NAMES = ["wide", "narrow"] as const;

type Width = (typeof WIDTH_NAMES)[number];

const WIDTHS = { wide: 760, narrow: 340 } satisfies Record<Width, number>;

const HEIGHT = 560;

const stateSession = (state: ComposerState) => asId<"session">(`composer-${state.name}`);

installScripted(
  scriptedConnection({
    sessions: STATES.map((state) =>
      sessionRow(stateSession(state), { name: `Composer ${state.name}` }),
    ),
    views: new Map(
      STATES.map((state) => [stateSession(state), state.view === undefined ? [] : [state.view]]),
    ),
    send: () => async (_content, options) => {
      const delivered = Promise.withResolvers<Delivered>();

      sends.push({
        end: (ending: SendEnding) => {
          if (ending === "refused") delivered.reject(REFUSED);
          else {
            delivered.resolve(
              ending === "unsent" ? { kind: ending, reason: null } : { kind: ending },
            );
          }
        },
      });

      return {
        id: options?.id ?? asId<"receipt">(crypto.randomUUID()),
        delivered: delivered.promise,
      };
    },
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
      run: (run) => ({
        id: run,
        stop: () => {
          const stop = Promise.withResolvers<StopOutcome<never>>();
          stops.push(stop);

          return stop.promise;
        },
        settled: () => new Promise(() => undefined),
      }),
      receipt: (receipt) => ({
        id: receipt,
        status: async () => ({ kind: "missing" }),
        settled: () => new Promise(() => undefined),
        stop: async () => {
          calls.push(`stop receipt ${receipt}`);

          return { kind: "missing" };
        },
      }),
    }),
    health,
    refused: refusals,
  }),
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
  queryClient.setQueryData(keys.mentionFiles(undefined), []);
}

function LoneComposer({ state }: { readonly state: ComposerState }): ReactElement {
  const sessionId = stateSession(state);
  const sessionView = useSessionView(sessionId);
  const messages = conversationMessages(sessionView);

  return (
    <Composer
      sessionId={sessionId}
      status={runStatus(sessionView?.execution)}
      pending={messages.queued}
      unsent={messages.unsent}
      expired={state.expired ?? []}
    />
  );
}

function Stage({
  state,
  layer,
  panes,
  shown,
}: {
  readonly state: ComposerState;
  readonly layer: Layer;
  readonly panes: TabPanes;
  readonly shown: boolean;
}): ReactElement {
  const [router] = useState(() =>
    createAppRouter({
      history: createMemoryHistory({ initialEntries: [`/session/${stateSession(state)}`] }),
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <TooltipProvider delay={0} closeDelay={0} timeout={0}>
          <PaneControllerProvider panes={panes}>
            <SessionDndProvider>
              {layer === "session" ? <SessionScreen /> : shown && <LoneComposer state={state} />}
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

async function show(host: HTMLElement, state: ComposerState, layer: Layer, width: Width) {
  const stage = document.createElement("div");
  stage.style.cssText = stageStyle(layer, width);
  host.replaceChildren(stage);
  failRender(undefined);

  const root = createRoot(stage, {
    onUncaughtError: (error) => {
      failRender(error);
    },
  });

  const panes = tabPanes();
  selectSession(panes, stateSession(state));

  const draw = (shown: boolean): void =>
    root.render(<Stage state={state} layer={layer} panes={panes} shown={shown} />);

  flushSync(() => draw(true));

  const probe = await probeStage(stage, layer, panes, state, draw);

  if (state.draft !== undefined) {
    await painted();
    probe.editor.focus();
    document.execCommand("insertText", false, state.draft);
  }

  await painted();
  await painted();

  return { stage, root, probe };
}

async function probeStage(
  stage: HTMLElement,
  layer: Layer,
  panes: TabPanes,
  state: ComposerState,
  draw: (shown: boolean) => void,
): Promise<Probe> {
  const region = await until(
    () => stage.querySelector<HTMLElement>("[data-composer-region]"),
    "the composer",
  );

  const editor = await until(
    () => region.querySelector<HTMLElement>("[data-placeholder]"),
    "the editor",
  );

  if (state.view !== undefined) {
    await until(
      () =>
        layer === "composer" ||
        stage.querySelector("[aria-label='Messages'] [data-row-key]") !== null
          ? true
          : null,
      "the transcript",
    );
  }

  const leave = (away: boolean): void => {
    if (layer === "composer") draw(!away);
    else selectSession(panes, away ? stateSession(STATES[0] ?? state) : stateSession(state));
  };

  return {
    layer,
    region,
    editor,
    button: (name) => region.querySelector<HTMLButtonElement>(`button[aria-label='${name}']`),
    stored: () => persistedDraft(panes.viewState.readSession(stateSession(state)).draft).draft,
    revisit: async (meanwhile) => {
      flushSync(() => leave(true));
      await until(() => (region.isConnected ? null : true), "the composer to leave");
      await painted();
      await meanwhile();
      flushSync(() => leave(false));

      return probeStage(stage, layer, panes, state, draw);
    },
  };
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

    if (box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5) {
      failures.push(
        `${element.tagName.toLowerCase()} spills ${(box.right - bounds.right).toFixed(1)}px past the stage`,
      );
    }

    if (box.top < bounds.top - 0.5) {
      failures.push(`${element.tagName.toLowerCase()} rises above the stage`);
    }
  }

  return failures;
}

export async function run(): Promise<string> {
  const failures: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);

  try {
    for (const state of STATES) {
      for (const layer of LAYERS) {
        for (const width of WIDTH_NAMES) {
          queryClient.clear();
          seedQueries();
          const label = `${state.name} · ${layer} · ${width}`;

          try {
            const { stage, root, probe } = await show(host, state, layer, width);

            for (const failure of [
              ...layoutFailures(stage, probe.region),
              ...(await state.check(probe)),
            ]) {
              failures.push(`${label}: ${failure}`);
            }
            flushSync(() => root.unmount());
          } catch (error) {
            failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
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
    ) {
      return;
    }
    const digit = Number(event.key);
    const count = STATES.length;

    if (Number.isInteger(digit) && digit >= 1 && digit <= count) select({ state: digit - 1 });
    else if (event.key === "ArrowRight") select({ state: (selection.state + 1) % count });
    else if (event.key === "ArrowLeft") select({ state: (selection.state - 1 + count) % count });
    else if (event.key === "l") {
      select({ layer: selection.layer === "composer" ? "session" : "composer" });
    } else if (event.key === "w") select({ width: selection.width === "wide" ? "narrow" : "wide" });
  });
  select({});
}

applyDisplayMode("light");
