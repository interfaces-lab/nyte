import { create, props } from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobActionOutcome, JobInfo, SessionId } from "@nyte-ai/protocol";
import { Row } from "@nyte-ai/ui/row";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { nyte } from "../../nyte.ts";
import { backgroundJobsOptions, keys } from "../../queries.ts";
import { Icon } from "../../components/icons.tsx";
import { Spinner } from "../../components/spinner.tsx";
import { focus } from "../../components/ui.tsx";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { useJobTerminals } from "../../workbench/terminal-store.ts";
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

export function BackgroundWork({
  sessionId,
  open,
  onOpenChange,
  onOpenTerminal,
  viewport,
}: {
  sessionId: SessionId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTerminal: (job: JobInfo, activate: boolean) => void;
  viewport: HTMLElement | null;
}) {
  const client = useQueryClient();
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
    .filter((job) => job.phase.kind === "running" && job.phase.mode === "background")
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
      onOpenTerminal(job, false);
    }
  }, [liveTerminals, onOpenTerminal]);

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
        <div role="alert" {...props(trayParts.notice, trayParts.error)}>
          Couldn’t load background work.
          <button
            type="button"
            {...props(trayParts.action, focus.ring)}
            onClick={() => void jobs.refetch()}
          >
            Try again
          </button>
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
          <button
            type="button"
            aria-label={
              stopCandidates !== undefined
                ? `Confirm stopping ${String(stopCandidates.length)} running terminals`
                : "Stop all running terminals"
            }
            {...props(trayParts.action, focus.ringInset)}
            disabled={pendingAction}
            onClick={() => {
              if (stopCandidates === undefined) {
                setStopCandidates(liveTerminals.map((job) => job.id));

                return;
              }

              stopAll.mutate(stopCandidates);
              setStopCandidates(undefined);
            }}
          >
            {stopCandidates !== undefined ? "Confirm" : "Stop all"}
          </button>
          <TrayIconAction icon="close" label="Close terminal list" onClick={close} />
        </div>
        <div
          data-nyte-scrollport
          {...props(trayStyles.list, trayParts.listHeight(availableHeight))}
        >
          {liveTerminals.map((job) => (
            <Row key={job.id} xstyle={[trayParts.row, styles.row]} interactive revealActions>
              <Row.Primary
                render={
                  <button
                    id={`${trayId}-${job.id}`}
                    type="button"
                    aria-label={`Open terminal for ${job.command}`}
                    title={job.command}
                    onClick={() => {
                      onOpenTerminal(job, true);
                      onOpenChange(false);
                    }}
                  />
                }
              >
                <Row.Leading aria-hidden="true">
                  <Icon name="console" size={16} />
                </Row.Leading>
                <Row.Label>{job.command}</Row.Label>
              </Row.Primary>
              <Row.Actions>
                <button
                  type="button"
                  aria-label={`Stop ${job.command}`}
                  {...props(trayParts.action, focus.ringInset)}
                  disabled={pendingAction}
                  onClick={() => cancel.mutate(job.id)}
                >
                  Stop
                </button>
              </Row.Actions>
            </Row>
          ))}
        </div>
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
          <div role="alert" {...props(trayParts.notice, trayParts.error)}>
            Failed to update background work. Try again.
          </div>
        )}
      </Tray>
    </div>
  );
}
