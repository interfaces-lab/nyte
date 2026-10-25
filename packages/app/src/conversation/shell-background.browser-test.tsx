import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ActOutcome, JobView, Message, SessionView } from "@nyte-ai/sdk";
import { showsTool } from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { asId, asSeq } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import type { ToolCallDensity } from "../preferences/index.ts";
import { queryClient } from "../queries.ts";
import { installConnection, sessionWatch, useWatchSelect } from "../sdk.tsx";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { COMPLETED, USAGE, sessionRow, settledTool } from "../../test/view-fixtures.ts";
import { ToolCallView } from "./tool-call.tsx";
import { TranscriptProvider } from "./transcript.tsx";
import { BackgroundWork } from "./tray/terminals.tsx";

const SESSION = asId<"session">("shell-background");

const CALL = "call-1";

const COMMAND = "pnpm --dir packages/app dev";

const SHELL = { kind: "shell", command: COMMAND, description: "Start the app dev server" } as const;

const running: ToolMessage = {
  id: asId<"message">(CALL),
  turn: asId<"turn">("turn"),
  at: 1,
  kind: "part",
  part: asId<"part">(CALL),
  partKind: "tool",
  role: "step",
  version: 1,
  state: {
    call: asId<"call">(CALL),
    name: "bash",
    args: { command: COMMAND },
    class: SHELL,
    phase: "running",
    progress: { text: "VITE ready in 412 ms\n  ➜  Local:   http://localhost:5173/" },
  },
  status: { kind: "live", run: asId<"run">("run") },
};

const job: JobView = {
  id: asId<"job">("job-1"),
  command: COMMAND,
  title: SHELL.description,
  session: SESSION,
  pty: null,
  state: { kind: "running" },
  startedAt: 1,
  endedAt: null,
  tail: "",
  foreground: true,
};

function view(message: Message): SessionView {
  return {
    revision: asId<"revision">(message.status.kind),
    seq: asSeq(1),
    activation: { kind: "active" },
    messages: [message],
    queue: [],
    leadingPrompt: null,
    parts: [],
    turns: [],
    usage: USAGE,
    execution: COMPLETED,
    reportsHeld: false,
    background: [
      {
        kind: "job",
        id: job.id,
        title: job.title,
        state: "working",
        startedBy: asId<"call">(CALL),
      },
    ],
    configuration: { selected: null, effective: null },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

const views = viewStream(view(running));

const jobs = viewStream<readonly JobView[]>([job]);

const acts: string[] = [];

const scripted = scriptedConnection({
  sessions: [sessionRow(SESSION)],
  views: new Map([[SESSION, views]]),
  session: () => ({
    part: (part) => ({
      id: part,
      update: async () => ({ kind: "missing" }),
      async act(action): Promise<ActOutcome<undefined>> {
        acts.push(`${part}:${String(action)}`);

        return { kind: "ok", output: undefined };
      },
      answer: async () => null,
      watch: async function* () {
        yield* [];
      },
      close: async () => undefined,
    }),
  }),
}).connection;

installConnection({
  ...scripted,
  workspace: (id) => {
    const workspace = scripted.workspace(id);

    return { ...workspace, jobs: { ...workspace.jobs, watch: () => jobs.watch() } };
  },
});

function ShellStep({ density }: { readonly density: ToolCallDensity }): ReactElement | null {
  const message = useWatchSelect(sessionWatch(SESSION), ({ value }) => value?.messages[0]);

  return message !== undefined && showsTool(message) ? (
    <ToolCallView message={message} cwd="/repo" density={density} />
  ) : null;
}

function Stage({
  density,
  viewport,
}: {
  readonly density: ToolCallDensity;
  readonly viewport: HTMLElement;
}): ReactElement {
  const [panes] = useState(() => new PaneController({ storageKey: "shell-background" }));
  const [open, setOpen] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delay={0} closeDelay={0} timeout={0}>
        <PaneControllerProvider controller={panes}>
          <TranscriptProvider paneId="primary" sessionId={SESSION}>
            <div style={{ padding: 16 }}>
              <ShellStep density={density} />
            </div>
            <BackgroundWork
              sessionId={SESSION}
              open={open}
              onOpenChange={setOpen}
              onOpenTerminal={() => "terminal"}
              viewport={viewport}
            />
          </TranscriptProvider>
        </PaneControllerProvider>
      </TooltipProvider>
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

function button(within: Element, name: string): HTMLButtonElement | undefined {
  return [...within.querySelectorAll("button")].find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
  );
}

export async function run(): Promise<string> {
  const failures: string[] = [];
  const stage = document.createElement("div");
  stage.style.cssText =
    "position:relative;display:flex;flex-direction:column;justify-content:space-between;width:640px;height:420px;";
  document.body.append(stage);

  const root = createRoot(stage, {
    onUncaughtError: (error) => {
      renderFailure = error;
    },
  });

  flushSync(() => root.render(<Stage density="compact" viewport={stage} />));

  const inline = await until(() => button(stage, "Move to background"), "the inline control");
  await painted();
  await painted();

  if (stage.querySelector("button[aria-description^='Open terminals']") !== null)
    failures.push("a foreground step shows the terminals pill");
  await capture("shell-running-compact");
  inline.click();
  await until(() => (acts.length > 0 ? acts : null), "the background action");

  if (acts.join() !== `${CALL}:background`) failures.push(`the step sent ${acts.join()}`);

  jobs.push([{ ...job, foreground: false }]);
  views.push(view(settledTool(CALL, SHELL, "[running in the background as job job-1]")));

  const pill = await until(
    () => stage.querySelector("button[aria-description='Open terminals (1)']"),
    "the terminals pill",
  );

  await until(
    () => (button(stage, "Move to background") === undefined ? true : null),
    "the inline control to leave",
  );

  if (pill instanceof HTMLElement) pill.click();
  await until(() => button(stage, "Stop Terminal"), "the tray's Stop Terminal");

  if (button(stage, "Move to Background") !== undefined)
    failures.push("the tray offers a background move");
  await painted();
  await capture("terminals-background");
  applyDisplayMode("dark");
  await painted();
  await capture("terminals-background-dark");
  applyDisplayMode("light");

  flushSync(() => root.unmount());
  views.push(view(running));
  jobs.push([job]);

  const detailed = createRoot(stage);
  flushSync(() => detailed.render(<Stage density="detailed" viewport={stage} />));

  const header = await until(() => button(stage, "Move to background"), "the card control");

  if (header.parentElement !== button(stage, "Copy command")?.parentElement)
    failures.push("the card control is not beside Copy command");
  header.focus();
  await painted();
  await capture("shell-running-detailed");
  flushSync(() => detailed.unmount());
  stage.remove();

  return failures.length === 0 ? "passed" : failures.join("\n");
}
