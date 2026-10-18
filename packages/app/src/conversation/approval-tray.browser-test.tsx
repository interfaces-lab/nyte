import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type {
  ActOutcome,
  HostView,
  Message,
  ModelCatalogView,
  PartView,
  RunView,
  SessionView,
} from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import type { HostState } from "../nyte.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import { SessionDndProvider } from "../layout/session-dnd.tsx";
import { keys, queryClient } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { ThreadScreen } from "../screens/thread.tsx";
import { createAppRouter } from "../router.tsx";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { PermissionsSection } from "../settings/permissions.tsx";
import { USAGE, endedTurn, sessionRow } from "../../test/view-fixtures.ts";

const SESSION = asId<"session">("approvals");

const COMMAND = "pnpm --dir packages/core test -- --run parked-gates";

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

const prompt: Message = {
  id: asId<"message">("prompt"),
  turn,
  at: 1,
  kind: "user",
  content: "Run the core tests for the parked gates.",
  source: { kind: "user" },
  delivery: "queue",
  status: { kind: "landed", commit: asId<"commit">("prompt"), run: null, replaced: null },
  siblings: { index: 0, count: 1, ids: [] },
};

function approval(id: string, command: string): PartView {
  return {
    id: asId<"part">(id),
    partKind: "ask/approval",
    placement: { kind: "modal" },
    state: {
      tool: "bash",
      class: { kind: "shell", command },
      reason: "shell",
      decision: null,
    },
    version: 1,
    status: { kind: "live", run: liveRun.id },
    owner: "approvals",
  };
}

function view(parts: readonly PartView[]): SessionView {
  const waiting = parts[0];

  return {
    revision: asId<"revision">(`r${String(parts.length)}`),
    seq: asSeq(1),
    activation: { kind: "active" },
    messages: [prompt],
    parts,
    turns: [
      endedTurn([], {
        id: turn,
        prompt: prompt.id,
        run: liveRun.id,
        steps: 1,
        state: { kind: "working", activity: null },
      }).info,
    ],
    usage: USAGE,
    execution:
      waiting === undefined
        ? { kind: "live", run: liveRun, phase: "executing", stopping: false }
        : { kind: "waiting", run: liveRun, on: { kind: "part", part: waiting.id } },
    background: [],
    configuration: { selected: liveRun.configuration, effective: liveRun.configuration },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

const views = viewStream(view([approval("first", COMMAND)]));

const acts: string[] = [];

let refusal: string | null = null;

const host: HostView = {
  id: asId<"host">("scripted"),
  link: { kind: "connected" },
  operations: null,
  name: "Test",
  platform: "linux",
  version: "0.0.0",
  catalog: asId<"catalog-generation">("initial"),
  plugins: [],
  settings: [
    {
      id: "permissions",
      owner: "approvals",
      scope: "host",
      label: "Permissions",
      schema: { type: "string" },
      choices: null,
      value: "auto-edit",
      from: "host",
    },
  ],
  defaultWorkspace: null,
  authority: new Set(),
};

installConnection(
  scriptedConnection({
    host: viewStream(host),
    sessions: [sessionRow(SESSION, { name: "Approvals" })],
    views: new Map([[SESSION, views]]),
    session: () => ({
      part: (part) => ({
        id: part,
        update: async () => ({ kind: "missing" }),
        async act(action): Promise<ActOutcome<undefined>> {
          acts.push(`${part}:${String(action)}`);

          return refusal === null
            ? { kind: "ok", output: undefined }
            : { kind: "rejected", reason: refusal };
        },
        answer: async () => null,
        close: async () => undefined,
      }),
    }),
  }).connection,
);

function Stage(): ReactElement {
  const [router] = useState(() =>
    createAppRouter({ history: createMemoryHistory({ initialEntries: [`/session/${SESSION}`] }) }),
  );

  const [panes] = useState(() => {
    const controller = new PaneController({ storageKey: "approval-tray" });
    controller.selectSession(SESSION);

    return controller;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <TooltipProvider delay={0} closeDelay={0} timeout={0}>
          <PaneControllerProvider controller={panes}>
            <SessionDndProvider>
              <ThreadScreen />
            </SessionDndProvider>
          </PaneControllerProvider>
        </TooltipProvider>
      </RouterContextProvider>
    </QueryClientProvider>
  );
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

async function capture(name: string): Promise<void> {
  const captured = new Promise((resolve) =>
    document.addEventListener("renderer-captured", resolve, { once: true }),
  );

  window.rendererCapture(name);
  await captured;
}

function labels(card: Element): readonly string[] {
  return [...card.querySelectorAll("button")].map((button) => button.textContent ?? "");
}

function press(key: string): void {
  document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

export async function run(): Promise<string> {
  const failures: string[] = [];
  const stage = document.createElement("div");
  stage.style.cssText =
    "position:relative;display:flex;flex-direction:column;width:760px;height:560px;";
  document.body.append(stage);
  queryClient.setQueryData(keys.host, { workspace: undefined } satisfies HostState);
  queryClient.setQueryData(keys.modelCatalog("initial"), {
    generation: asId<"catalog-generation">("initial"),
    providers: [],
    default: { provider: "test", id: "test" },
  } satisfies ModelCatalogView);
  queryClient.setQueryData(keys.mentionFiles, []);

  const root = createRoot(stage, {
    onUncaughtError: (error) => {
      renderFailure = error;
    },
  });

  flushSync(() => root.render(<Stage />));

  const card = await until(() => stage.querySelector("[data-part='ask/approval']"), "the approval");
  await painted();
  await capture("approval-arrived");

  if (card.querySelector("h2")?.textContent !== "Run this command?")
    failures.push(`title reads ${card.querySelector("h2")?.textContent ?? "nothing"}`);

  if (card.querySelector("pre")?.textContent !== COMMAND) failures.push("the command is not shown");

  if (labels(card).join(" | ") !== "Allow once | Allow for this session | Deny")
    failures.push(`answers read ${labels(card).join(" | ")}`);

  if (document.activeElement !== card)
    failures.push(`focus starts on ${document.activeElement?.textContent ?? "nothing"}`);

  press("Enter");
  await painted();

  if (acts.length > 0) failures.push(`Enter on the arriving card sent ${acts.join()}`);

  press("ArrowLeft");

  if (document.activeElement?.textContent !== "Deny")
    failures.push(`← from the card moves to ${document.activeElement?.textContent ?? "nothing"}`);

  if (card instanceof HTMLElement) card.focus();
  press("ArrowRight");

  if (document.activeElement?.textContent !== "Allow once")
    failures.push(`→ from the card moves to ${document.activeElement?.textContent ?? "nothing"}`);

  press("ArrowRight");

  if (document.activeElement?.textContent !== "Allow for this session")
    failures.push(`→ moves focus to ${document.activeElement?.textContent ?? "nothing"}`);

  press("ArrowLeft");
  press("ArrowLeft");

  if (document.activeElement?.textContent !== "Deny")
    failures.push(
      `← from the first answer moves to ${document.activeElement?.textContent ?? "nothing"}`,
    );

  press("ArrowRight");
  await painted();
  await capture("approval-light");
  applyDisplayMode("dark");
  await painted();
  await capture("approval-dark");
  applyDisplayMode("light");

  const session = [...card.querySelectorAll("button")].find(
    (button) => button.textContent === "Allow for this session",
  );

  session?.click();
  await until(() => (acts.length > 0 ? acts : null), "the answer");

  if (acts.join() !== "first:session") failures.push(`sent ${acts.join()}`);

  views.push(view([]));
  await until(
    () => (stage.querySelector("[data-part='ask/approval']") === null ? true : null),
    "the tray to close",
  );
  await painted();
  await capture("approval-answered");

  refusal = "This approval was already answered.";
  views.push(view([approval("second", "git push --force")]));

  const next = await until(
    () => stage.querySelector("[data-part='ask/approval'] pre[id]")?.closest("[data-part]"),
    "the next approval",
  );

  await until(
    () => (next.querySelector("pre")?.textContent === "git push --force" ? true : null),
    "the next command",
  );
  press("Escape");

  const alert = await until(() => next.querySelector("[role='alert']"), "the refusal");

  if (alert.textContent !== refusal) failures.push(`the refusal reads ${alert.textContent ?? ""}`);

  if (acts.join() !== "first:session,second:deny") failures.push(`Escape sent ${acts.join()}`);
  await painted();
  await capture("approval-refused");

  flushSync(() => root.unmount());

  const settings = createRoot(stage);
  flushSync(() =>
    settings.render(
      <QueryClientProvider client={queryClient}>
        <PermissionsSection />
      </QueryClientProvider>,
    ),
  );

  const row = await until(
    () => stage.querySelector("[aria-label='Tool approvals']")?.closest("section"),
    "the permissions setting",
  );

  if (!(row.textContent ?? "").includes("Edits workspace files, asks before commands"))
    failures.push(`the setting reads ${row.textContent ?? ""}`);
  await painted();
  await capture("permissions-setting");
  flushSync(() => settings.unmount());
  stage.remove();

  return failures.length === 0 ? "passed" : failures.join("\n");
}
