import { create, props } from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobInfo, SessionId } from "@nyte-ai/core";
import { Row } from "@nyte-ai/ui/row";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { nyte } from "../nyte.ts";
import { keys } from "../queries.ts";
import { Icon } from "../components/icons.tsx";
import { Spinner } from "../components/spinner.tsx";
import { focus } from "../components/ui.tsx";
import { trayStyles } from "../theme/tray.stylex.ts";
import { layer, tray } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { isJobTerminal, useTerminals } from "../workbench/terminal-store.ts";
import { jobActionMessage, jobControls, jobStateLabel, taskSections } from "./jobs-view.ts";
import { SubagentModel } from "./subagent-call.tsx";

const styles = create({
  root: { position: "relative", minWidth: 0 },
  previewRoot: { height: 28 },
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
  previewTray: {
    position: "absolute",
    insetInline: 0,
    bottom: 0,
    zIndex: layer.stickyContent,
  },
  previewHeight: (height: number) => ({
    // A short split pane must still leave its header reachable.
    height: `min(70dvh, ${String(Math.min(Math.max(220, height), height + 36))}px)`,
  }),
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
  agentHead: { display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 },
  rowLabel: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  showMore: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    minHeight: tray.rowHeight,
    paddingBlock: 4,
    paddingInline: tray.rowInset,
    borderStyle: "none",
    borderRadius: 6,
    lineHeight: tray.lineHeight,
    backgroundColor: "transparent",
    textAlign: "start",
    color: t.textPrimary,
    cursor: "pointer",
  },
  agentModel: {
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: t.textTertiary,
    fontSize: t.fontSm,
  },
  recent: {
    paddingBlock: 6,
    paddingInline: 0,
    color: t.textSecondary,
    fontSize: t.fontBase,
    fontVariantNumeric: "tabular-nums",
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
  preview: {
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    paddingInline: 12,
    paddingTop: 6,
    paddingBottom: 12,
  },
  previewMeta: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 8 },
  previewStatus: {
    display: "inline-flex",
    flex: 1,
    gap: 6,
    minWidth: 0,
    color: t.textTertiary,
    fontSize: t.fontSm,
  },
  output: {
    margin: 0,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: t.fontMono,
    fontSize: t.fontSm,
    lineHeight: t.leadingBase,
    userSelect: "text",
  },
  notice: { paddingBlock: 8, paddingInline: 12, color: t.textSecondary, fontSize: t.fontSm },
  error: { color: t.textDanger },
});

export type BackgroundWorkSection = "agents" | "terminals";

export function BackgroundWork({
  sessionId,
  terminalOwner,
  open,
  onOpenChange,
  onInspect,
  onOpenTerminal,
  viewport,
}: {
  sessionId: SessionId;
  terminalOwner: string;
  open: BackgroundWorkSection | undefined;
  onOpenChange: (section: BackgroundWorkSection | undefined) => void;
  onInspect: (id: SessionId) => void;
  onOpenTerminal: (job: Extract<JobInfo, { kind: "command" }>) => void;
  viewport: HTMLElement | null;
}) {
  const client = useQueryClient();
  const hasTerminalObserver = useTerminals(terminalOwner).tabs.some(isJobTerminal);
  const jobs = useQuery({
    queryKey: keys.jobs(sessionId),
    queryFn: () => nyte.jobs.list({ sessionId }),
    // An adopted terminal keeps this query polling when the conversation unmounts.
    refetchInterval: hasTerminalObserver ? false : 2_000,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const agentsRef = useRef<HTMLButtonElement>(null);
  const terminalsRef = useRef<HTMLButtonElement>(null);
  const trayId = useId();
  const [previewId, setPreviewId] = useState<string>();
  const [recentLimit, setRecentLimit] = useState(5);
  const [stopCandidates, setStopCandidates] = useState<readonly JobInfo["id"][]>();
  const [availableHeight, setAvailableHeight] = useState(260);
  const action = useMutation({
    mutationFn: ({
      jobId,
      operation,
    }: {
      jobId: JobInfo["id"];
      operation: "background" | "cancel";
    }) => nyte.jobs[operation]({ sessionId, jobId }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.jobs(sessionId) }),
  });
  const orderedJobs = (jobs.data ?? []).toSorted((left, right) => right.updatedAt - left.updatedAt);
  const agents = taskSections(orderedJobs.filter((job) => job.kind === "subagent"));
  const liveTerminals = orderedJobs.filter(
    (job) => job.kind === "command" && job.mode === "background" && job.state === "running",
  );
  const hasAgents = agents.active.length + agents.finished.length > 0;
  const hasTerminals = liveTerminals.length > 0;
  const trayOpen =
    open === "terminals" && hasTerminals ? "terminals" : open === "agents" ? "agents" : undefined;
  const sections = trayOpen === "terminals" ? { active: liveTerminals, finished: [] } : agents;
  const preview = [...sections.active, ...sections.finished].find((job) => job.id === previewId);
  const stopAll = useMutation({
    mutationFn: (jobIds: readonly JobInfo["id"][]) =>
      Promise.all(jobIds.map((jobId) => nyte.jobs.cancel({ sessionId, jobId }))),
    onSettled: () => client.invalidateQueries({ queryKey: keys.jobs(sessionId) }),
  });
  const pendingAction = action.isPending || stopAll.isPending;

  useLayoutEffect(() => {
    if (open === "terminals" && !hasTerminals) onOpenChange(undefined);
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
  }, [hasAgents, hasTerminals, viewport]);

  const close = () => {
    onOpenChange(undefined);
    setPreviewId(undefined);
    requestAnimationFrame(() =>
      (trayOpen === "terminals" ? terminalsRef : agentsRef).current?.focus(),
    );
  };
  const back = () => {
    if (previewId === undefined) return;
    const rowId = `${trayId}-${previewId}`;
    setPreviewId(undefined);
    requestAnimationFrame(() => document.getElementById(rowId)?.focus());
  };
  const toggle = (section: BackgroundWorkSection) => {
    setPreviewId(undefined);
    setRecentLimit(5);
    setStopCandidates(undefined);
    action.reset();
    stopAll.reset();
    onOpenChange(open === section ? undefined : section);
  };
  const title =
    trayOpen === "terminals"
      ? `${String(liveTerminals.length)} ${liveTerminals.length === 1 ? "Terminal" : "Terminals"} Running`
      : agents.active.length > 0
        ? "Working"
        : "Agents";

  // Until the list lands there is nothing to say: most chats have no jobs, and
  // a placeholder here would sit under a transcript that already painted.
  if (!jobs.isError && !hasAgents && !hasTerminals) return null;

  return (
    <div ref={rootRef} {...props(styles.root, preview !== undefined && styles.previewRoot)}>
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
      {trayOpen === undefined && (
        <div {...props(styles.pills)}>
          {hasAgents && (
            <button
              ref={agentsRef}
              type="button"
              {...props(styles.pill, focus.ring)}
              aria-label={
                agents.active.length > 0
                  ? `Agents, Working ${String(agents.active.length)}`
                  : "Agents"
              }
              aria-expanded={false}
              onClick={() => toggle("agents")}
            >
              {agents.active.length > 0 && (
                <span {...props(styles.leading)}>
                  <Spinner />
                </span>
              )}
              <span>{agents.active.length > 0 ? "Working" : "Agents"}</span>
              {agents.active.length > 0 && <span aria-hidden="true">{agents.active.length}</span>}
            </button>
          )}
          {hasTerminals && (
            <button
              ref={terminalsRef}
              type="button"
              {...props(styles.pill, focus.ring)}
              aria-label={`Open terminals (${String(liveTerminals.length)})`}
              aria-expanded={false}
              onClick={() => toggle("terminals")}
            >
              <span {...props(styles.leading)}>
                <Spinner />
              </span>
              <span aria-hidden="true">{liveTerminals.length}</span>
              <span>{liveTerminals.length === 1 ? "Terminal" : "Terminals"}</span>
            </button>
          )}
        </div>
      )}
      {trayOpen !== undefined && (
        <section
          id={trayId}
          aria-label={trayOpen === "agents" ? "Agents" : "Terminals"}
          {...props(
            trayStyles.surface,
            preview !== undefined && styles.previewTray,
            preview !== undefined && styles.previewHeight(availableHeight),
          )}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            if (preview !== undefined) {
              back();
              return;
            }
            close();
          }}
        >
          <div {...props(trayStyles.header)}>
            {preview !== undefined && (
              <button
                type="button"
                aria-label="Back to background work"
                title="Back to background work"
                {...props(styles.action, styles.iconAction, focus.ringInset)}
                onClick={back}
              >
                <Icon name="arrow-left" size={16} />
              </button>
            )}
            <span title={preview?.title} {...props(trayStyles.title)}>
              {preview?.title ?? title}
            </span>
            {preview?.kind === "subagent" && (
              <button
                type="button"
                aria-label="Inspect conversation"
                title="Inspect conversation"
                {...props(styles.action, styles.iconAction, focus.ringInset)}
                onClick={() => {
                  close();
                  onInspect(preview.childSessionId);
                }}
              >
                <Icon name="expand" size={16} />
              </button>
            )}
            {preview === undefined && sections.active.length > 0 && (
              <button
                type="button"
                aria-label={
                  stopCandidates !== undefined
                    ? `Confirm stopping ${String(stopCandidates.length)} running ${trayOpen}`
                    : `Stop all running ${trayOpen}`
                }
                {...props(styles.action, focus.ringInset)}
                disabled={pendingAction}
                onClick={() => {
                  if (stopCandidates === undefined) {
                    setStopCandidates(sections.active.map((job) => job.id));
                    return;
                  }
                  stopAll.mutate(stopCandidates);
                  setStopCandidates(undefined);
                }}
              >
                {stopCandidates !== undefined ? "Confirm" : "Stop All"}
              </button>
            )}
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
          {preview === undefined ? (
            <div
              data-nyte-scrollport
              {...props(trayStyles.list, styles.trayHeight(availableHeight))}
            >
              {sections.active.length === 0 && sections.finished.length === 0 && (
                <div {...props(styles.notice)}>No background work.</div>
              )}
              {[...sections.active, ...sections.finished.slice(0, recentLimit)].map(
                (job, index) => (
                  <div key={job.id}>
                    {sections.active.length > 0 && index === sections.active.length && (
                      <div {...props(styles.recent)}>
                        {Math.min(recentLimit, sections.finished.length)} Recent
                      </div>
                    )}
                    <Row xstyle={styles.row} interactive revealActions>
                      <Row.Primary
                        render={
                          <button
                            id={`${trayId}-${job.id}`}
                            type="button"
                            aria-label={
                              job.kind === "command"
                                ? `Open terminal for ${job.title}`
                                : `View output for ${job.title}`
                            }
                            title={job.title}
                            onClick={() => {
                              if (job.kind === "command") {
                                onOpenTerminal(job);
                                onOpenChange(undefined);
                                return;
                              }
                              action.reset();
                              setPreviewId(job.id);
                            }}
                          />
                        }
                      >
                        <Row.Leading
                          aria-hidden="true"
                          xstyle={job.state === "failed" && styles.error}
                        >
                          {job.kind === "command" ? (
                            <Icon name="console" size={16} />
                          ) : job.state === "running" ? (
                            <Spinner />
                          ) : (
                            <Icon
                              name={
                                job.state === "completed"
                                  ? "checkmark"
                                  : job.state === "failed"
                                    ? "warning"
                                    : "circle-x"
                              }
                              size={14}
                            />
                          )}
                        </Row.Leading>
                        {job.kind === "command" ? (
                          <>
                            <Row.Label>{job.title}</Row.Label>
                            <Row.Meta>{jobStateLabel(job)}</Row.Meta>
                          </>
                        ) : (
                          <Row.Body>
                            <Row.Label xstyle={styles.agentHead}>
                              <span {...props(styles.rowLabel)}>{job.title}</span>
                              <SubagentModel
                                childSessionId={job.childSessionId}
                                style={styles.agentModel}
                              />
                            </Row.Label>
                            <Row.Description>{jobStateLabel(job)}</Row.Description>
                          </Row.Body>
                        )}
                      </Row.Primary>
                      {jobControls(job).cancel && (
                        <Row.Actions>
                          <button
                            type="button"
                            aria-label={`Stop ${job.title}`}
                            {...props(styles.action, focus.ringInset)}
                            disabled={pendingAction}
                            onClick={() => action.mutate({ jobId: job.id, operation: "cancel" })}
                          >
                            Stop
                          </button>
                        </Row.Actions>
                      )}
                    </Row>
                  </div>
                ),
              )}
              {sections.finished.length > recentLimit && (
                <button
                  type="button"
                  {...props(styles.showMore, focus.ringInset)}
                  onClick={() => setRecentLimit((limit) => limit + 8)}
                >
                  More
                </button>
              )}
            </div>
          ) : (
            <div data-nyte-scrollport {...props(styles.preview)}>
              <div {...props(styles.previewMeta)}>
                <span {...props(styles.previewStatus)}>
                  {preview.kind === "subagent" && (
                    <SubagentModel childSessionId={preview.childSessionId} separator=" · " />
                  )}
                  {jobStateLabel(preview)}
                </span>
                {jobControls(preview).background && (
                  <button
                    type="button"
                    {...props(styles.action, focus.ringInset)}
                    disabled={pendingAction}
                    onClick={() => action.mutate({ jobId: preview.id, operation: "background" })}
                  >
                    Run in background
                  </button>
                )}
                {jobControls(preview).cancel && (
                  <button
                    type="button"
                    {...props(styles.action, focus.ringInset)}
                    disabled={pendingAction}
                    onClick={() => action.mutate({ jobId: preview.id, operation: "cancel" })}
                  >
                    Stop
                  </button>
                )}
              </div>
              <pre aria-label="Output" {...props(styles.output)}>
                {preview.output || "No output yet."}
              </pre>
            </div>
          )}
          {action.isSuccess && (
            <div role="status" {...props(styles.notice)}>
              {jobActionMessage(action.data, action.variables.operation)}
            </div>
          )}
          {stopAll.isSuccess && (
            <div role="status" {...props(styles.notice)}>
              {stopAll.data.every((outcome) => outcome.kind === "applied")
                ? "Cancellation requested."
                : "Some work has already finished or is no longer available."}
            </div>
          )}
          {(action.isError || stopAll.isError) && (
            <div role="alert" {...props(styles.notice, styles.error)}>
              Failed to update background work. Try again.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
