import { intent } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobActionOutcome, JobInfo, SessionId } from "@nyte-ai/protocol";
import { Row } from "@nyte-ai/ui/row";
// oxlint-disable-next-line no-restricted-imports -- each live terminal job opens once as it appears
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { nyte } from "../../nyte.ts";
import { usePaneControllerSnapshot } from "../../layout/pane-context.tsx";
import { activeSelection } from "../../layout/pane-layout.ts";
import { backgroundJobsOptions, keys } from "../../queries.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Button } from "@nyte-ai/ui/button";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { useJobTerminals } from "../../workbench/terminal-store.ts";
import { focusTerminal } from "../../workbench/terminal-runtime.ts";
import { Tray, TrayIconAction, TrayPill, trayParts, useTrayRoot } from "./tray.tsx";

const styles = create({
  row: { paddingInlineEnd: 4 },
});

function jobActionMessage(outcome: JobActionOutcome): string {
  switch (outcome.kind) {
    case "applied":
      return "Cancellation requested.";
    case "not_found":
      return "This task is no longer available.";
    case "finished":
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
  readonly onOpenTerminal: (job: JobInfo, activate: boolean) => string;
  readonly viewport: HTMLElement | null;
}

function AvailableBackgroundWork({
  sessionId,
  open,
  onOpenChange,
  onOpenTerminal,
  viewport,
}: BackgroundWorkProps) {
  const client = useQueryClient();
  const { layout } = usePaneControllerSnapshot();
  const focusedSelection = activeSelection(layout);
  const focused = focusedSelection.kind === "session" && focusedSelection.sessionId === sessionId;
  const hasTerminalObserver = useJobTerminals(sessionId).length > 0;

  const jobs = useQuery({
    ...backgroundJobsOptions(sessionId),
    // An adopted terminal keeps this query polling when the conversation unmounts.
    refetchInterval: hasTerminalObserver ? false : 2_000,
  });

  const { root, ref, availableHeight } = useTrayRoot(viewport);
  const pillRef = useRef<HTMLButtonElement>(null);
  const openedJobIds = useRef(new Set<JobInfo["id"]>());
  const trayId = useId();
  const [stopCandidates, setStopCandidates] = useState<readonly JobInfo["id"][]>();

  const cancel = useMutation({
    mutationFn: (jobId: JobInfo["id"]) => nyte.jobs.cancel({ sessionId, jobId }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.jobs(sessionId) }),
  });

  const stopAll = useMutation({
    mutationFn: (jobIds: readonly JobInfo["id"][]) =>
      Promise.all(jobIds.map((jobId) => nyte.jobs.cancel({ sessionId, jobId }))),
    onSettled: () => client.invalidateQueries({ queryKey: keys.jobs(sessionId) }),
  });

  const liveTerminals = (jobs.data ?? [])
    .filter((job) => job.isBackgrounded && job.phase.kind === "running")
    .toSorted((left, right) => right.updatedAt - left.updatedAt);

  const hasTerminals = liveTerminals.length > 0;
  const trayOpen = open && hasTerminals;
  const pendingAction = cancel.isPending || stopAll.isPending;
  const count = String(liveTerminals.length);
  const noun = liveTerminals.length === 1 ? "Terminal" : "Terminals";

  useEffect(() => {
    for (const job of liveTerminals) {
      if (openedJobIds.current.has(job.id)) continue;
      openedJobIds.current.add(job.id);
      onOpenTerminal(job, focused);
    }
  }, [focused, liveTerminals, onOpenTerminal]);

  useLayoutEffect(() => {
    if (open && !hasTerminals) onOpenChange(false);
  }, [hasTerminals, onOpenChange, open]);

  const close = () => {
    const held = root?.contains(document.activeElement) === true;
    onOpenChange(false);

    if (held) requestAnimationFrame(() => pillRef.current?.focus());
  };

  // Until the list lands there is nothing to say: most chats have no jobs, and
  // a placeholder here would sit under a transcript that already painted.
  if (!jobs.isError && !hasTerminals) return null;

  return (
    <div ref={ref} {...props(trayParts.root)}>
      {jobs.isError && (
        <div role="alert" {...props(intent.danger, trayParts.notice, trayParts.error)}>
          Couldn’t load background work.
          <Button onClick={() => void jobs.refetch()}>Try Again</Button>
        </div>
      )}
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
          <span aria-hidden="true">{liveTerminals.length}</span>
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
            <Row key={job.id} xstyle={[trayParts.row, styles.row]} interactive>
              <Row.Primary
                id={`${trayId}-${job.id}`}
                aria-label={`Open terminal for ${job.command}`}
                title={job.command}
                onClick={() => {
                  focusTerminal(onOpenTerminal(job, true));
                  onOpenChange(false);
                }}
              >
                <Row.Leading aria-hidden="true">
                  <Icon name="console" size={16} />
                </Row.Leading>
                <Row.Label>{job.command}</Row.Label>
              </Row.Primary>
              <Row.Actions>
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
            {stopAll.data.every((outcome) => outcome.kind === "applied")
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

export function BackgroundWork(props: BackgroundWorkProps) {
  return nyte.host.terminal === undefined ? null : <AvailableBackgroundWork {...props} />;
}
