import { create, props } from "@stylexjs/stylex";
import { Row } from "@nyte-ai/ui/row";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import type { TargetAndTransition, Transition } from "motion/react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";
import { Icon } from "../components/icons.tsx";
import { Spinner } from "../components/spinner.tsx";
import { focus } from "../components/ui.tsx";
import { nyte } from "../nyte.ts";
import { keys, useSession } from "../queries.ts";
import { tray } from "../theme/schema.stylex.ts";
import { trayStyles } from "../theme/tray.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { subagentTrayState } from "./agent-status.ts";

export type SubagentTrayView =
  | { readonly kind: "closed" }
  | { readonly kind: "list" }
  | { readonly kind: "detail"; readonly sessionId: SessionId };

const TRAY_STATE_LABEL = {
  working: "Working",
  attention: "Needs attention",
  inactive: "Completed",
} satisfies Readonly<Record<ReturnType<typeof subagentTrayState>, string>>;

const styles = create({
  root: { position: "relative", minWidth: 0 },
  presenceContent: { display: "contents" },
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
    lineHeight: "16px",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "color, background-color, border-color, opacity, transform",
    transitionDuration: "150ms",
    transitionTimingFunction: t.easeOut,
  },
  pillIndicator: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 10,
    height: 10,
    color: t.iconSecondary,
    lineHeight: 0,
  },
  spinnerScale: { display: "inline-flex", transform: "scale(0.6667)" },
  attentionDot: {
    display: "block",
    width: 6,
    height: 6,
    borderRadius: t.radiusFull,
    backgroundColor: t.textWarning,
  },
  count: { color: t.textTertiary },
  surface: {
    borderRadius: t.radiusXl,
    backgroundColor: t.bgElevated,
    boxShadow: `${t.trayShadow}, inset 0 0 0 1px ${t.strokeTertiary}`,
    backdropFilter: "blur(8px)",
  },
  listHeader: {
    gap: 8,
    minHeight: 28,
    paddingTop: 8,
    paddingBottom: 0,
    paddingInlineStart: 12,
    paddingInlineEnd: 8,
  },
  detailHeader: { gap: 8, paddingBlock: 8, paddingInline: 8 },
  title: { fontSize: t.fontBase, lineHeight: "18px", color: t.textSecondary },
  list: { gap: 1, paddingTop: 4, paddingBottom: 6, paddingInline: 0 },
  listHeight: (height: number) => ({ maxHeight: Math.min(260, height) }),
  detailHeight: (height: number) => ({
    height: `min(70dvh, max(220px, ${String(height)}px))`,
  }),
  row: {
    "--nyte-row-height": tray.rowHeight,
    "--nyte-row-gap": "8px",
    "--nyte-row-padding-inline": "6px",
    "--nyte-row-leading-size": "10px",
    "--_row-fill": {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${t.fillGhostHover} 50%, transparent)`,
      ":focus-within": `color-mix(in srgb, ${t.fillGhostHover} 50%, transparent)`,
    },
    minHeight: 28,
    paddingInlineEnd: 4,
    borderRadius: t.radiusBase,
    color: t.textPrimary,
    fontSize: t.fontBase,
    lineHeight: "18px",
  },
  runningIndicator: {
    display: "grid",
    placeItems: "center",
    width: 10,
    height: 10,
    color: t.iconSecondary,
    lineHeight: 0,
  },
  state: {
    flexShrink: 0,
    color: t.textTertiary,
    fontSize: t.fontBase,
    lineHeight: "18px",
  },
  action: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    minHeight: 28,
    paddingBlock: 0,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: t.radiusBase,
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
    lineHeight: 0,
    color: {
      default: t.iconSecondary,
      ":hover": t.iconPrimary,
      ":focus-visible": t.iconPrimary,
    },
    "::before": { content: '""', position: "absolute", inset: -6 },
  },
  detail: { display: "flex", flexDirection: "column", minHeight: 0 },
  detailBody: {
    display: "flex",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  notice: { paddingBlock: 8, paddingInline: 12, color: t.textSecondary, fontSize: t.fontSm },
  error: { color: t.textDanger },
});

function agentTitle(agent: SessionInfo | undefined, sessionId: SessionId): string {
  return agent?.name ?? agent?.preview ?? sessionId;
}

function PresenceContent({ children }: { readonly children: ReactNode }): ReactElement {
  const isPresent = useIsPresent();
  return (
    <div inert={!isPresent} {...props(styles.presenceContent)}>
      {children}
    </div>
  );
}

export function SubagentTray({
  parentSessionId,
  agents,
  view,
  onViewChange,
  onExpand,
  onRelease,
  viewport,
  detail,
}: {
  readonly parentSessionId: SessionId;
  readonly agents: readonly SessionInfo[];
  readonly view: SubagentTrayView;
  readonly onViewChange: (view: SubagentTrayView) => void;
  readonly onExpand: (sessionId: SessionId) => void;
  readonly onRelease: () => void;
  readonly viewport: HTMLElement | null;
  readonly detail: ReactNode;
}): ReactElement | null {
  const client = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const trayId = useId();
  const reducedMotion = useReducedMotion();
  const [availableHeight, setAvailableHeight] = useState(260);
  const [stopCandidates, setStopCandidates] = useState<readonly SessionId[]>();
  const stop = useMutation({
    mutationFn: (sessionId: SessionId) => nyte.runs.abort({ sessionId }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.childSessions(parentSessionId) }),
  });
  const stopAll = useMutation({
    mutationFn: (sessionIds: readonly SessionId[]) =>
      Promise.all(sessionIds.map((sessionId) => nyte.runs.abort({ sessionId }))),
    onSettled: () => client.invalidateQueries({ queryKey: keys.childSessions(parentSessionId) }),
  });
  const active = useMemo(
    () =>
      agents
        .filter((agent) => subagentTrayState(agent) !== "inactive")
        .toSorted((left, right) => {
          const attention =
            Number(subagentTrayState(left) !== "attention") -
            Number(subagentTrayState(right) !== "attention");
          return (
            attention ||
            right.lastActivityAt - left.lastActivityAt ||
            left.sessionId.localeCompare(right.sessionId)
          );
        }),
    [agents],
  );
  const running = active.filter((agent) => subagentTrayState(agent) !== "attention");
  const stoppable = active;
  const selectedId = view.kind === "detail" ? view.sessionId : undefined;
  const selectedSession = useSession(selectedId ?? parentSessionId);
  const selected =
    selectedId === undefined
      ? undefined
      : (selectedSession.data ?? agents.find((agent) => agent.sessionId === selectedId));
  const pendingAction = stop.isPending || stopAll.isPending;
  const surfaceTransition: Transition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.15, ease: "easeOut" };
  const surfaceInitial = reducedMotion ? false : { opacity: 0, y: 4, scale: 0.99 };
  const surfaceExit: TargetAndTransition = reducedMotion
    ? { opacity: 1, pointerEvents: "none" }
    : { opacity: 0, y: 4, scale: 0.99, pointerEvents: "none" };

  useLayoutEffect(() => {
    if (view.kind === "closed") return;
    rootRef.current?.querySelector<HTMLElement>("section")?.focus({ preventScroll: true });
  }, [view.kind]);

  useLayoutEffect(() => {
    if (view.kind !== "list" || active.length > 0) return;
    const held = rootRef.current?.contains(document.activeElement) === true;
    onViewChange({ kind: "closed" });
    if (held) onRelease();
  }, [active.length, onRelease, onViewChange, view.kind]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null || viewport === null) return undefined;
    const measure = (): void => {
      setAvailableHeight(
        Math.max(
          0,
          root.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top - 44,
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [view.kind, viewport]);

  const close = (): void => {
    setStopCandidates(undefined);
    stop.reset();
    stopAll.reset();
    const held = rootRef.current?.contains(document.activeElement) === true;
    onViewChange({ kind: "closed" });
    if (held) onRelease();
  };

  if ((view.kind === "closed" || view.kind === "list") && active.length === 0) return null;

  return (
    <div ref={rootRef} {...props(styles.root)}>
      {view.kind === "closed" && (
        <div {...props(styles.pills)}>
          <button
            type="button"
            aria-label={running.length > 0 ? `Agents, Working ${String(running.length)}` : "Agents"}
            aria-controls={trayId}
            aria-expanded={false}
            {...props(styles.pill, focus.ring)}
            onClick={() => onViewChange({ kind: "list" })}
          >
            <span {...props(styles.pillIndicator)}>
              {running.length > 0 ? (
                <span {...props(styles.spinnerScale)}>
                  <Spinner />
                </span>
              ) : (
                <span {...props(styles.attentionDot)} />
              )}
            </span>
            <span>{running.length > 0 ? "Working" : "Agents"}</span>
            {running.length > 0 && (
              <span aria-hidden="true" {...props(styles.count)}>
                {String(running.length)}
              </span>
            )}
          </button>
        </div>
      )}
      <AnimatePresence initial={false}>
        {view.kind !== "closed" && (view.kind === "detail" || active.length > 0) && (
          <motion.section
            key="surface"
            id={trayId}
            tabIndex={-1}
            aria-label={selectedId === undefined ? "Agents" : agentTitle(selected, selectedId)}
            initial={surfaceInitial}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={surfaceExit}
            transition={surfaceTransition}
            {...props(
              trayStyles.surface,
              styles.surface,
              view.kind === "detail" && styles.detail,
              view.kind === "detail" && styles.detailHeight(availableHeight),
            )}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || event.defaultPrevented) return;
              event.preventDefault();
              event.stopPropagation();
              close();
            }}
          >
            <PresenceContent>
              {view.kind === "list" && (
                <>
                  <div {...props(trayStyles.header, styles.listHeader)}>
                    <span {...props(trayStyles.title, styles.title)}>
                      {running.length > 0 ? "Working" : "Agents"}
                    </span>
                    {stoppable.length > 0 && (
                      <button
                        type="button"
                        aria-label={
                          stopCandidates === undefined
                            ? "Stop all running agents"
                            : `Confirm stopping ${String(stopCandidates.length)} running agents`
                        }
                        disabled={pendingAction}
                        {...props(styles.action, focus.ringInset)}
                        onClick={() => {
                          if (stopCandidates === undefined) {
                            setStopCandidates(stoppable.map((agent) => agent.sessionId));
                            return;
                          }
                          const candidates = new Set(stopCandidates);
                          stopAll.mutate(
                            stoppable
                              .filter((agent) => candidates.has(agent.sessionId))
                              .map((agent) => agent.sessionId),
                          );
                          setStopCandidates(undefined);
                        }}
                      >
                        {stopCandidates === undefined ? "Stop All" : "Confirm"}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Close agents"
                      title="Close agents"
                      {...props(styles.action, styles.iconAction, focus.ringInset)}
                      onClick={close}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                  <div
                    data-nyte-scrollport
                    {...props(trayStyles.list, styles.list, styles.listHeight(availableHeight))}
                  >
                    {active.map((agent) => {
                      const state = subagentTrayState(agent);
                      return (
                        <Row key={agent.sessionId} xstyle={styles.row} interactive>
                          <Row.Primary
                            render={
                              <button
                                type="button"
                                aria-label={`Open ${agentTitle(agent, agent.sessionId)}`}
                                onClick={() => {
                                  setStopCandidates(undefined);
                                  onViewChange({ kind: "detail", sessionId: agent.sessionId });
                                }}
                              />
                            }
                          >
                            <Row.Leading aria-hidden="true">
                              {state === "attention" ? (
                                <span {...props(styles.attentionDot)} />
                              ) : (
                                <span {...props(styles.runningIndicator)}>
                                  <span {...props(styles.spinnerScale)}>
                                    <Spinner />
                                  </span>
                                </span>
                              )}
                            </Row.Leading>
                            <Row.Label>{agentTitle(agent, agent.sessionId)}</Row.Label>
                          </Row.Primary>
                          <Row.Meta>
                            <span {...props(styles.state)}>{TRAY_STATE_LABEL[state]}</span>
                          </Row.Meta>
                        </Row>
                      );
                    })}
                  </div>
                  {(stop.isError || stopAll.isError) && (
                    <div role="alert" {...props(styles.notice, styles.error)}>
                      Couldn’t stop the agent. Try again.
                    </div>
                  )}
                </>
              )}
              {view.kind === "detail" && selectedId !== undefined && (
                <>
                  <div {...props(trayStyles.header, styles.detailHeader)}>
                    <button
                      type="button"
                      aria-label="Back to agents"
                      title="Back to agents"
                      {...props(styles.action, styles.iconAction, focus.ringInset)}
                      onClick={() => onViewChange({ kind: "list" })}
                    >
                      <Icon name="arrow-left" size={16} />
                    </button>
                    <span
                      title={agentTitle(selected, selectedId)}
                      {...props(trayStyles.title, styles.title)}
                    >
                      {agentTitle(selected, selectedId)}
                    </span>
                    {selected !== undefined && subagentTrayState(selected) !== "inactive" && (
                      <button
                        type="button"
                        disabled={pendingAction}
                        {...props(styles.action, focus.ringInset)}
                        onClick={() => stop.mutate(selectedId)}
                      >
                        Stop
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Open agent as full chat"
                      title="Open as full chat"
                      {...props(styles.action, styles.iconAction, focus.ringInset)}
                      onClick={() => onExpand(selectedId)}
                    >
                      <Icon name="expand" size={15} />
                    </button>
                    <button
                      type="button"
                      aria-label="Close agents"
                      title="Close agents"
                      {...props(styles.action, styles.iconAction, focus.ringInset)}
                      onClick={close}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                  <div {...props(styles.detailBody)}>{detail}</div>
                  {stop.isError && (
                    <div role="alert" {...props(styles.notice, styles.error)}>
                      Couldn’t stop the agent. Try again.
                    </div>
                  )}
                </>
              )}
            </PresenceContent>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
