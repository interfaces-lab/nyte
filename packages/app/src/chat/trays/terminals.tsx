import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import type { JobEnd, JobId, JobView, SessionId, StopOutcome } from "@nyte-ai/sdk";
import { useId, useRef } from "react";
import { trayTasks } from "../../chats/index.ts";
import type { JobTask, Task } from "../../chats/index.ts";
import { connection } from "../../data/connection.ts";
import { useSessionRow } from "../../data/session-rows.ts";
import type { TrayView } from "../../window/index.ts";
import { openJobOutput } from "../tools/job-output.ts";
import { TaskList, useStopTasks } from "./task-list.tsx";
import { pillCounts, Tray, TrayPill, trayParts, useTrayRoot } from "./tray.tsx";

export type TerminalsTrayView = Extract<TrayView, { readonly kind: "closed" | "terminals" }>;

export type TerminalTask = JobTask & { readonly job: JobView };

export function listTerminals(
  tasks: readonly Task[],
  cleared: ReadonlySet<string>,
): readonly TerminalTask[] {
  return trayTasks(
    tasks.filter(
      (task): task is TerminalTask => task.kind === "job" && task.job?.foreground === false,
    ),
    cleared,
  );
}

interface BackgroundWorkProps {
  readonly sessionId: SessionId;
  readonly terminals: readonly TerminalTask[];
  readonly open: boolean;
  readonly onViewChange: (view: TerminalsTrayView) => void;
  readonly viewport: HTMLElement | null;
}

export function BackgroundWork({
  sessionId,
  terminals,
  open,
  onViewChange,
  viewport,
}: BackgroundWorkProps) {
  const workspace = useSessionRow(sessionId, (session) => session.workspace) ?? undefined;
  const { root, ref, availableHeight } = useTrayRoot(viewport);
  const pillRef = useRef<HTMLButtonElement>(null);
  const trayId = useId();

  const stop = useStopTasks((jobId: JobId): Promise<StopOutcome<JobEnd>> =>
    workspace === undefined
      ? Promise.resolve({ kind: "missing" })
      : connection().workspace(workspace).job(jobId).stop(),
  );

  const trayOpen = open && terminals.length > 0;

  const missing = stop.outcomes?.some((outcome) => outcome.kind === "missing") === true;

  const close = () => {
    const held = root?.contains(document.activeElement) === true;
    onViewChange({ kind: "closed" });

    if (held) pillRef.current?.focus();
  };

  return (
    <div ref={ref} {...props(trayParts.root)}>
      <Tray open={trayOpen} id={trayId} label="Terminals" focusKey="terminals" onClose={close}>
        <TaskList
          parent={sessionId}
          tasks={terminals}
          noun="terminals"
          label={(terminal) => terminal.job.command}
          maxHeight={availableHeight}
          stopping={stop.stopping}
          onStop={stop.run}
          onOpen={(terminal) => {
            openJobOutput(sessionId, terminal.job);
            onViewChange({ kind: "closed" });
          }}
        />
        {missing && (
          <div role="status" {...props(trayParts.notice)}>
            The host no longer has this job.
          </div>
        )}
        {stop.failed && (
          <div role="alert" {...props(intent.danger, trayParts.notice, trayParts.error)}>
            Couldn’t stop the terminal. Try again.
          </div>
        )}
      </Tray>
      {terminals.length > 0 && (
        <TrayPill
          ref={pillRef}
          icon="console"
          title="Terminals"
          description={`Open terminals (${pillCounts(terminals)})`}
          tasks={terminals}
          expanded={trayOpen}
          controls={trayId}
          onClick={() => {
            if (trayOpen) {
              onViewChange({ kind: "closed" });

              return;
            }

            stop.reset();
            onViewChange({
              kind: "terminals",
              openedOver: terminals.map((terminal) => terminal.id),
            });
          }}
        />
      )}
    </div>
  );
}
