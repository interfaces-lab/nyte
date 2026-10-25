import { intent } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { useMutation } from "@tanstack/react-query";
import type { JobEnd, JobView, SessionId, StopOutcome } from "@nyte-ai/sdk";
import { Row } from "@nyte-ai/ui/row";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { useSession, useWorkspaceJobs } from "../../queries.ts";
import { connection } from "../../sdk.tsx";
import { Icon } from "@nyte-ai/ui/icon";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Button } from "@nyte-ai/ui/button";
import { tray } from "../../theme/schema.stylex.ts";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { readDeferred } from "../../deferred.tsx";
import { Tray, TrayIconAction, TrayPill, trayParts, useTrayRoot } from "./tray.tsx";

const styles = create({
  actions: { marginInlineEnd: `calc(${space.s1} + ${tray.rowInset} - ${tray.paddingInline})` },
});

function jobActionMessage(outcome: StopOutcome<JobEnd>): string {
  switch (outcome.kind) {
    case "requested":
      return "Cancellation requested.";
    case "missing":
      return "This task is no longer available.";
    case "settled":
      return "This task has already finished. Its output is still available.";
    default: {
      const exhaustive: never = outcome;

      return exhaustive;
    }
  }
}

interface BackgroundWorkProps {
  readonly sessionId: SessionId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenTerminal: (job: JobView) => string;
  readonly viewport: HTMLElement | null;
}

export function BackgroundWork({
  sessionId,
  open,
  onOpenChange,
  onOpenTerminal,
  viewport,
}: BackgroundWorkProps) {
  const workspace = useSession(sessionId, (session) => session.workspace).data ?? undefined;
  const jobs = useWorkspaceJobs(workspace);

  const { root, ref, availableHeight } = useTrayRoot(viewport);
  const pillRef = useRef<HTMLButtonElement>(null);
  const trayId = useId();
  const [stopCandidates, setStopCandidates] = useState<readonly JobView["id"][]>();

  const stopJob = (jobId: JobView["id"]): Promise<StopOutcome<JobEnd>> => {
    if (workspace === undefined) return Promise.resolve({ kind: "missing" });

    return connection().workspace(workspace).job(jobId).stop();
  };

  const cancel = useMutation({ mutationFn: stopJob });

  const stopAll = useMutation({
    mutationFn: (jobIds: readonly JobView["id"][]) => Promise.all(jobIds.map(stopJob)),
  });

  const liveTerminals = (jobs ?? [])
    .filter((job) => job.session === sessionId && job.state.kind === "running" && !job.foreground)
    .toSorted((left, right) => right.startedAt - left.startedAt);

  const hasTerminals = liveTerminals.length > 0;
  const trayOpen = open && hasTerminals;
  const pendingAction = cancel.isPending || stopAll.isPending;
  const count = String(liveTerminals.length);
  const noun = liveTerminals.length === 1 ? "Terminal" : "Terminals";

  useLayoutEffect(() => {
    if (open && !hasTerminals) onOpenChange(false);
  }, [hasTerminals, onOpenChange, open]);

  const close = () => {
    const held = root?.contains(document.activeElement) === true;
    onOpenChange(false);

    if (held) requestAnimationFrame(() => pillRef.current?.focus());
  };

  if (!hasTerminals) return null;

  return (
    <div ref={ref} {...props(trayParts.root)}>
      {!trayOpen && hasTerminals && (
        <TrayPill
          ref={pillRef}
          label={`Open terminals (${count})`}
          controls={trayId}
          onClick={() => {
            setStopCandidates(undefined);
            cancel.reset();
            stopAll.reset();
            onOpenChange(true);
          }}
        >
          <span {...props(trayParts.pillIndicator)}>
            <Spinner />
          </span>
          <span aria-hidden="true" {...props(trayParts.pillCount)}>
            {liveTerminals.length}
          </span>
          <span>{noun}</span>
        </TrayPill>
      )}
      <Tray open={trayOpen} id={trayId} label="Terminals" focusKey="terminals" onClose={close}>
        <div {...props(trayStyles.header)}>
          <span {...props(trayStyles.title)}>{`${count} ${noun.toLowerCase()}`}</span>
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
                setStopCandidates(liveTerminals.map((job) => job.id));

                return;
              }

              stopAll.mutate(stopCandidates);
              setStopCandidates(undefined);
            }}
          >
            Stop Terminals
          </Button>
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
          {liveTerminals.map((job) => (
            <Row key={job.id} xstyle={trayParts.row} interactive>
              <Row.Primary
                id={`${trayId}-${job.id}`}
                aria-label={`Open terminal for ${job.command}`}
                title={job.command}
                onClick={() => {
                  const terminal = onOpenTerminal(job);

                  readDeferred("workbench")?.focusTerminal(terminal);
                  onOpenChange(false);
                }}
              >
                <Row.Leading aria-hidden="true">
                  <Icon name="console" size={16} />
                </Row.Leading>
                <Row.Label>{job.command}</Row.Label>
              </Row.Primary>
              <Row.Actions xstyle={styles.actions}>
                <Button
                  aria-description={`Stop ${job.command}`}
                  tone="danger"
                  loading={stopAll.isPending || (cancel.isPending && cancel.variables === job.id)}
                  disabled={pendingAction}
                  onClick={() => cancel.mutate(job.id)}
                >
                  Stop Terminal
                </Button>
              </Row.Actions>
            </Row>
          ))}
        </div>
        {pendingAction && (
          <div role="status" {...props(trayParts.notice)}>
            {stopAll.isPending ? "Stopping terminals…" : "Stopping terminal…"}
          </div>
        )}
        {cancel.isSuccess && (
          <div role="status" {...props(trayParts.notice)}>
            {jobActionMessage(cancel.data)}
          </div>
        )}
        {stopAll.isSuccess && (
          <div role="status" {...props(trayParts.notice)}>
            {stopAll.data.every((outcome) => outcome.kind === "requested")
              ? "Cancellation requested."
              : "Some work has already finished or is no longer available."}
          </div>
        )}
        {(cancel.isError || stopAll.isError) && (
          <div role="alert" {...props(intent.danger, trayParts.notice, trayParts.error)}>
            Failed to update background work. Try again.
          </div>
        )}
      </Tray>
    </div>
  );
}
