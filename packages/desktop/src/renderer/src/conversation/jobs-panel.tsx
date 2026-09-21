import { create, props } from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobInfo, SessionId } from "@nyte-ai/protocol";
import { Row } from "@nyte-ai/ui/row";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { nyte } from "../nyte.ts";
import { keys } from "../queries.ts";
import { Icon } from "../components/icons.tsx";
import { Spinner } from "../components/spinner.tsx";
import { focus } from "../components/ui.tsx";
import { trayStyles } from "../theme/tray.stylex.ts";
import { tray } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { useJobTerminals } from "../workbench/terminal-store.ts";
import { jobActionMessage } from "./jobs-view.ts";

const styles = create({
  root: { position: "relative", minWidth: 0 },
  pills: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: 28,
    paddingBlock: 0,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: t.strokeTertiary,
      ":hover": t.strokeSecondary,
      ":focus-visible": t.strokeSecondary,
    },
    borderRadius: t.radiusFull,
    backgroundColor: { default: t.bgElevated, ":hover": t.fillGhostHover },
    color: { default: t.textSecondary, ":hover": t.textPrimary },
    fontSize: t.fontBase,
    fontWeight: 400,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  leading: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    marginInlineEnd: 4,
    lineHeight: 0,
  },
  trayHeight: (height: number) => ({ maxHeight: Math.min(260, height) }),
  row: {
    "--nyte-row-height": tray.rowHeight,
    "--nyte-row-gap": "6px",
    "--nyte-row-padding-inline": tray.rowInset,
    "--nyte-row-leading-size": "16px",
    // This list wants a lighter resting fill than the shared hover step.
    "--_row-fill": {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${t.fillGhostHover} 50%, transparent)`,
      ":focus-within": `color-mix(in srgb, ${t.fillGhostHover} 50%, transparent)`,
    },
    paddingInlineEnd: 4,
    borderRadius: 6,
    lineHeight: tray.lineHeight,
    color: t.textPrimary,
  },
  action: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    flexShrink: 0,
    minHeight: tray.rowHeight,
    paddingBlock: 0,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: t.radiusSm,
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": t.fillGhostHover,
      ":focus-visible": t.fillGhostHover,
      ":active:not(:disabled)": t.fillGhostSelected,
    },
    color: {
      default: t.textSecondary,
      ":hover:not(:disabled)": t.textPrimary,
      ":focus-visible": t.textPrimary,
    },
    fontSize: t.fontSm,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.5 },
  },
  iconAction: {
    position: "relative",
    width: 28,
    height: 28,
    paddingInline: 0,
    borderRadius: t.radiusBase,
    lineHeight: 0,
    color: {
      default: t.iconSecondary,
      ":hover": t.iconPrimary,
      ":focus-visible": t.iconPrimary,
    },
    // Header spacing reserves a non-overlapping 40px target around the 28px control.
    "::before": { content: '""', position: "absolute", inset: -6 },
  },
  notice: { paddingBlock: 8, paddingInline: 12, color: t.textSecondary, fontSize: t.fontSm },
  error: { color: t.textDanger },
});

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
    queryKey: keys.jobs(sessionId),
    queryFn: () => nyte.jobs.list({ sessionId }),
    // An adopted terminal keeps this query polling when the conversation unmounts.
    refetchInterval: hasTerminalObserver ? false : 2_000,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const openedJobIds = useRef(new Set<JobInfo["id"]>());
  const trayId = useId();
  const [stopCandidates, setStopCandidates] = useState<readonly JobInfo["id"][]>();
  const [availableHeight, setAvailableHeight] = useState(260);
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

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null || viewport === null) return undefined;
    const measure = () =>
      setAvailableHeight(
        Math.max(
          0,
          root.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top - 44,
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [hasTerminals, viewport]);

  const close = () => {
    onOpenChange(false);
    requestAnimationFrame(() => pillRef.current?.focus());
  };

  // Until the list lands there is nothing to say: most chats have no jobs, and
  // a placeholder here would sit under a transcript that already painted.
  if (!jobs.isError && !hasTerminals) return null;

  return (
    <div ref={rootRef} {...props(styles.root)}>
      {jobs.isError && (
        <div role="alert" {...props(styles.notice, styles.error)}>
          Couldn’t load background work.
          <button
            type="button"
            {...props(styles.action, focus.ring)}
            onClick={() => void jobs.refetch()}
          >
            Try again
          </button>
        </div>
      )}
      {!trayOpen && hasTerminals && (
        <div {...props(styles.pills)}>
          <button
            ref={pillRef}
            type="button"
            {...props(styles.pill, focus.ring)}
            aria-label={`Open terminals (${count})`}
            aria-expanded={false}
            onClick={() => {
              setStopCandidates(undefined);
              cancel.reset();
              stopAll.reset();
              onOpenChange(true);
            }}
          >
            <span {...props(styles.leading)}>
              <Spinner />
            </span>
            <span aria-hidden="true">{liveTerminals.length}</span>
            <span>{noun}</span>
          </button>
        </div>
      )}
      {trayOpen && (
        <section
          id={trayId}
          aria-label="Terminals"
          {...props(trayStyles.surface)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <div {...props(trayStyles.header)}>
            <span {...props(trayStyles.title)}>{`${count} ${noun} Running`}</span>
            <button
              type="button"
              aria-label={
                stopCandidates !== undefined
                  ? `Confirm stopping ${String(stopCandidates.length)} running terminals`
                  : "Stop all running terminals"
              }
              {...props(styles.action, focus.ringInset)}
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
              {stopCandidates !== undefined ? "Confirm" : "Stop All"}
            </button>
            <button
              type="button"
              aria-label="Close background work"
              title="Close background work"
              {...props(styles.action, styles.iconAction, focus.ringInset)}
              onClick={close}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div data-nyte-scrollport {...props(trayStyles.list, styles.trayHeight(availableHeight))}>
            {liveTerminals.map((job) => (
              <Row key={job.id} xstyle={styles.row} interactive revealActions>
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
                    {...props(styles.action, focus.ringInset)}
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
            <div role="status" {...props(styles.notice)}>
              {jobActionMessage(cancel.data)}
            </div>
          )}
          {stopAll.isSuccess && (
            <div role="status" {...props(styles.notice)}>
              {stopAll.data.every((outcome) => outcome.kind === "applied")
                ? "Cancellation requested."
                : "Some work has already finished or is no longer available."}
            </div>
          )}
          {(cancel.isError || stopAll.isError) && (
            <div role="alert" {...props(styles.notice, styles.error)}>
              Failed to update background work. Try again.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
