import { create, props } from "@stylexjs/stylex";
import { Row } from "@nyte-ai/ui/row";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { AGENT_STATE_LABEL, agentState } from "./agent-status.ts";

export type SubagentTrayView =
  | { readonly kind: "closed" }
  | { readonly kind: "list" }
  | { readonly kind: "detail"; readonly sessionId: SessionId };

const styles = create({
  root: { position: "relative", minWidth: 0 },
  pills: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
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
    lineHeight: t.leadingSm,
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  leading: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    lineHeight: 0,
  },
  listHeight: (height: number) => ({ maxHeight: Math.min(260, height) }),
  detailHeight: (height: number) => ({
    height: `min(70dvh, max(220px, ${String(height)}px))`,
  }),
  row: {
    "--nyte-row-height": tray.rowHeight,
    "--nyte-row-gap": "8px",
    "--nyte-row-padding-inline": tray.rowInset,
    "--nyte-row-leading-size": "16px",
    "--_row-fill": {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${t.fillGhostHover} 50%, transparent)`,
      ":focus-within": `color-mix(in srgb, ${t.fillGhostHover} 50%, transparent)`,
    },
    paddingInlineEnd: 4,
    borderRadius: t.radiusBase,
    color: t.textPrimary,
  },
  state: {
    flexShrink: 0,
    color: t.textTertiary,
    fontSize: t.fontSm,
    fontVariantNumeric: "tabular-nums",
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
  detailBody: { display: "flex", flex: 1, minHeight: 0, overflow: "hidden" },
  notice: { paddingBlock: 8, paddingInline: 12, color: t.textSecondary, fontSize: t.fontSm },
  error: { color: t.textDanger },
});

function agentTitle(agent: SessionInfo | undefined, sessionId: SessionId): string {
  return agent?.name ?? agent?.preview ?? sessionId;
}

export function SubagentTray({
  parentSessionId,
  agents,
  view,
  onViewChange,
  onExpand,
  viewport,
  detail,
}: {
  readonly parentSessionId: SessionId;
  readonly agents: readonly SessionInfo[];
  readonly view: SubagentTrayView;
  readonly onViewChange: (view: SubagentTrayView) => void;
  readonly onExpand: (sessionId: SessionId) => void;
  readonly viewport: HTMLElement | null;
  readonly detail: ReactNode;
}): ReactElement | null {
  const client = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const trayId = useId();
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
  const ordered = useMemo(
    () =>
      view.kind === "list"
        ? agents.toSorted((left, right) => {
            const activity =
              Number(agentState(right) === "working") - Number(agentState(left) === "working");
            return activity === 0 ? right.lastActivityAt - left.lastActivityAt : activity;
          })
        : agents,
    [agents, view.kind],
  );
  const working = ordered.filter((agent) => agentState(agent) === "working");
  const selectedId = view.kind === "detail" ? view.sessionId : undefined;
  const selectedSession = useSession(selectedId ?? parentSessionId);
  const selected =
    selectedId === undefined
      ? undefined
      : (selectedSession.data ?? agents.find((agent) => agent.sessionId === selectedId));
  const pendingAction = stop.isPending || stopAll.isPending;

  useLayoutEffect(() => {
    if (view.kind === "closed") return;
    rootRef.current?.querySelector<HTMLElement>("section")?.focus({ preventScroll: true });
  }, [view.kind]);

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
    onViewChange({ kind: "closed" });
    requestAnimationFrame(() => pillRef.current?.focus());
  };

  if (view.kind === "closed" && agents.length === 0) return null;

  return (
    <div ref={rootRef} {...props(styles.root)}>
      {view.kind === "closed" && (
        <div {...props(styles.pills)}>
          <button
            ref={pillRef}
            type="button"
            aria-label={`Open agents (${String(agents.length)})`}
            aria-controls={trayId}
            aria-expanded={false}
            {...props(styles.pill, focus.ring)}
            onClick={() => onViewChange({ kind: "list" })}
          >
            <span {...props(styles.leading)}>
              {working.length > 0 ? <Spinner /> : <Icon name="robot" size={15} />}
            </span>
            <span>{String(agents.length)}</span>
            <span>{agents.length === 1 ? "Agent" : "Agents"}</span>
          </button>
        </div>
      )}
      {view.kind === "list" && (
        <section
          id={trayId}
          tabIndex={-1}
          aria-label="Agents"
          {...props(trayStyles.surface)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <div {...props(trayStyles.header)}>
            <span {...props(trayStyles.title)}>
              {String(agents.length)} {agents.length === 1 ? "Agent" : "Agents"}
            </span>
            {working.length > 0 && (
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
                    setStopCandidates(working.map((agent) => agent.sessionId));
                    return;
                  }
                  const candidates = new Set(stopCandidates);
                  stopAll.mutate(
                    working
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
          <div data-nyte-scrollport {...props(trayStyles.list, styles.listHeight(availableHeight))}>
            {ordered.map((agent) => {
              const state = agentState(agent);
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
                      {state === "working" ? <Spinner /> : <Icon name="robot" size={15} />}
                    </Row.Leading>
                    <Row.Label>{agentTitle(agent, agent.sessionId)}</Row.Label>
                  </Row.Primary>
                  <Row.Meta>
                    <span {...props(styles.state)}>{AGENT_STATE_LABEL[state]}</span>
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
        </section>
      )}
      {view.kind === "detail" && selectedId !== undefined && (
        <section
          id={trayId}
          tabIndex={-1}
          aria-label={agentTitle(selected, selectedId)}
          {...props(trayStyles.surface, styles.detail, styles.detailHeight(availableHeight))}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <div {...props(trayStyles.header)}>
            <button
              type="button"
              aria-label="Back to agents"
              title="Back to agents"
              {...props(styles.action, styles.iconAction, focus.ringInset)}
              onClick={() => onViewChange({ kind: "list" })}
            >
              <Icon name="arrow-left" size={16} />
            </button>
            <span title={agentTitle(selected, selectedId)} {...props(trayStyles.title)}>
              {agentTitle(selected, selectedId)}
            </span>
            {selected !== undefined && agentState(selected) === "working" && (
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
        </section>
      )}
    </div>
  );
}
