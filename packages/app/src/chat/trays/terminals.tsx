import { intent } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { useMutation } from "@tanstack/react-query";
import type { JobEnd, JobId, JobView, SessionId, StopOutcome } from "@nyte-ai/sdk";
import { taskEnded, taskLabel } from "@nyte-ai/plugin/client/presentation";
import { Row } from "@nyte-ai/ui/row";
import { useId, useRef, useState } from "react";
import { trayTasks } from "../../chats/index.ts";
import type { JobTask, Task } from "../../chats/index.ts";
import { TaskMark } from "../../components/task-mark.tsx";
import { connection } from "../../data/connection.ts";
import { useSessionRow } from "../../data/session-rows.ts";
import { Button } from "@nyte-ai/ui/button";
import { tray } from "../../theme/schema.stylex.ts";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { chatWindow } from "../../window/index.ts";
import type { TrayView } from "../../window/index.ts";
import { openJobOutput } from "../tools/job-output.ts";
import { pillCounts, pillState } from "./agents.tsx";
import { Tray, TrayIconAction, trayParts, useTrayRoot } from "./tray.tsx";

export type TerminalsTrayView = Extract<TrayView, { readonly kind: "closed" | "terminals" }>;

export type TerminalTask = JobTask & { readonly job: JobView };

/** A job its call still holds shows in that call's row instead. */
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

const styles = create({
  actions: { marginInlineEnd: `calc(${space.s1} + ${tray.rowInset} - ${tray.paddingInline})` },
});

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
  const [stopCandidates, setStopCandidates] = useState<readonly JobId[]>();

  const stopJob = (jobId: JobId): Promise<StopOutcome<JobEnd>> => {
    if (workspace === undefined) return Promise.resolve({ kind: "missing" });

    return connection().workspace(workspace).job(jobId).stop();
  };

  const cancel = useMutation({ mutationFn: stopJob });

  const stopAll = useMutation({
    mutationFn: (jobIds: readonly JobId[]) => Promise.all(jobIds.map(stopJob)),
  });

  const live = terminals.filter((terminal) => terminal.live);
  const ended = terminals.filter((terminal) => taskEnded(terminal.state));
  const trayOpen = open && terminals.length > 0;
  const pendingAction = cancel.isPending || stopAll.isPending;
  const count = String(terminals.length);
  const noun = terminals.length === 1 ? "Terminal" : "Terminals";

  const missing =
    (cancel.isSuccess && cancel.data.kind === "missing") ||
    (stopAll.isSuccess && stopAll.data.some((outcome) => outcome.kind === "missing"));

  const close = () => {
    const held = root?.contains(document.activeElement) === true;
    onViewChange({ kind: "closed" });

    if (held) pillRef.current?.focus();
  };

  return (
    <div ref={ref} {...props(trayParts.root)}>
      <Tray open={trayOpen} id={trayId} label="Terminals" focusKey="terminals" onClose={close}>
        <div {...props(trayStyles.header)}>
          <span {...props(trayStyles.title)}>{`${count} ${noun.toLowerCase()}`}</span>
          {ended.length > 0 && (
            <Button
              onClick={() =>
                chatWindow.act({
                  kind: "clear",
                  parent: sessionId,
                  tasks: ended.map((terminal) => terminal.id),
                })
              }
            >
              Clear Finished
            </Button>
          )}
          {live.length > 0 && (
            <Button
              aria-description={
                stopCandidates !== undefined
                  ? `Confirm stopping ${String(stopCandidates.length)} running terminals`
                  : "Stop all running terminals"
              }
              tone="danger"
              loading={stopAll.isPending}
              disabled={cancel.isPending}
              onClick={() => {
                if (stopCandidates === undefined) {
                  setStopCandidates(live.map((terminal) => terminal.id));

                  return;
                }

                stopAll.mutate(stopCandidates);
                setStopCandidates(undefined);
              }}
            >
              Stop Terminals
            </Button>
          )}
          <TrayIconAction icon="close" label="Close terminal list" onClick={close} />
        </div>
        {stopCandidates !== undefined && (
          <div role="status" {...props(trayParts.notice)}>
            Stop {String(stopCandidates.length)} running terminals? Select Stop Terminals again to
            stop them.
          </div>
        )}
        <div
          data-nyte-scrollport
          {...props(trayStyles.list, trayParts.listHeight(availableHeight))}
        >
          {terminals.map((terminal) => (
            <Row key={terminal.id} xstyle={trayParts.row} interactive>
              <Row.Primary
                id={`${trayId}-${terminal.id}`}
                aria-label={`Open terminal for ${terminal.job.command}`}
                title={terminal.job.command}
                onClick={() => {
                  openJobOutput(sessionId, terminal.job);
                  onViewChange({ kind: "closed" });
                }}
              >
                <Row.Leading aria-hidden="true">
                  <TaskMark state={terminal.state} job />
                </Row.Leading>
                <Row.Label>{terminal.job.command}</Row.Label>
              </Row.Primary>
              {terminal.live ? (
                <Row.Actions xstyle={styles.actions}>
                  <Button
                    aria-description={`Stop ${terminal.job.command}`}
                    tone="danger"
                    loading={
                      stopAll.isPending || (cancel.isPending && cancel.variables === terminal.id)
                    }
                    disabled={pendingAction}
                    onClick={() => cancel.mutate(terminal.id)}
                  >
                    Stop Terminal
                  </Button>
                </Row.Actions>
              ) : (
                <Row.Meta>{taskLabel(terminal.state)}</Row.Meta>
              )}
            </Row>
          ))}
        </div>
        {pendingAction && (
          <div role="status" {...props(trayParts.notice)}>
            {stopAll.isPending ? "Stopping terminals…" : "Stopping terminal…"}
          </div>
        )}
        {missing && (
          <div role="status" {...props(trayParts.notice)}>
            The host no longer has this job.
          </div>
        )}
        {(cancel.isError || stopAll.isError) && (
          <div role="alert" {...props(intent.danger, trayParts.notice, trayParts.error)}>
            Couldn’t stop the terminal. Try again.
          </div>
        )}
      </Tray>
      {terminals.length > 0 && (
        <div {...props(trayParts.pills)}>
          <Button
            ref={pillRef}
            variant="outline"
            pill
            size="sm"
            aria-description={`Open terminals (${pillCounts(terminals)})`}
            aria-controls={trayId}
            aria-expanded={trayOpen}
            onClick={() => {
              if (trayOpen) {
                onViewChange({ kind: "closed" });

                return;
              }

              setStopCandidates(undefined);
              cancel.reset();
              stopAll.reset();
              onViewChange({
                kind: "terminals",
                openedOver: terminals.map((terminal) => terminal.id),
              });
            }}
          >
            <span aria-hidden="true" {...props(trayParts.pillIndicator)}>
              <TaskMark state={pillState(terminals)} job />
            </span>
            <span aria-hidden="true" {...props(trayParts.pillCount)}>
              {count}
            </span>
            <span>{noun}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
