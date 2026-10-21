import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { Row } from "@nyte-ai/ui/row";
import { useMutation } from "@tanstack/react-query";
import { useId, useLayoutEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { StatusDot } from "../../components/ui.tsx";
import { Button } from "@nyte-ai/ui/button";
import { useChildSessions, useSession } from "../../queries.ts";
import { connection } from "../../sdk.tsx";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { subagentTrayState } from "../agent-status.ts";
import type { SubagentTrayState } from "../agent-status.ts";
import { Tray, TrayIconAction, TrayPill, trayParts, useTrayRoot } from "./tray.tsx";
import { useCommitCount } from "../../work-counts.ts";

export type SubagentTrayView =
  | { readonly kind: "closed" }
  | { readonly kind: "list"; readonly retainedSessionId: SessionId | undefined }
  | { readonly kind: "detail"; readonly sessionId: SessionId };

const TRAY_STATE_LABEL = {
  working: "Working",
  attention: "Needs attention",
  inactive: "Completed",
} satisfies Readonly<Record<SubagentTrayState, string>>;

const styles = create({
  attentionDot: {
    display: "block",
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: role.contentInteractiveTertiary,
  },
  detail: (height: number) => ({
    minHeight: 0,
    height: `min(70dvh, max(220px, ${String(height)}px))`,
  }),
  detailBody: { display: "flex", flex: 1, minHeight: 0, overflow: "clip" },
});

const NO_AGENTS: readonly SessionInfo[] = [];

function agentTitle(agent: SessionInfo | undefined, sessionId: SessionId): string {
  return agent?.name ?? sessionId;
}

export function SubagentTray({
  parentSessionId,
  view,
  onViewChange,
  onExpand,
  onRelease,
  viewport,
  detail,
}: {
  readonly parentSessionId: SessionId;
  readonly view: SubagentTrayView;
  readonly onViewChange: (view: SubagentTrayView) => void;
  readonly onExpand: (sessionId: SessionId) => void;
  readonly onRelease: () => void;
  readonly viewport: HTMLElement | null;
  readonly detail: ReactNode;
}): ReactElement | null {
  useCommitCount("render:agents-tray");
  const agents = useChildSessions(parentSessionId).data ?? NO_AGENTS;
  const { root, ref, availableHeight } = useTrayRoot(viewport);
  const trayId = useId();
  const [stopCandidates, setStopCandidates] = useState<readonly SessionId[]>();

  const pinnedId =
    view.kind === "detail"
      ? view.sessionId
      : view.kind === "list"
        ? view.retainedSessionId
        : undefined;

  const stop = useMutation({
    mutationFn: (sessionId: SessionId) => connection().session(sessionId).stop(),
  });

  const stopAll = useMutation({
    mutationFn: (sessionIds: readonly SessionId[]) =>
      Promise.all(sessionIds.map((sessionId) => connection().session(sessionId).stop())),
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
            left.id.localeCompare(right.id)
          );
        }),
    [agents],
  );

  const running = active.filter((agent) => subagentTrayState(agent) === "working");

  const settled = agents.find(
    (agent) => agent.id === pinnedId && subagentTrayState(agent) === "inactive",
  );

  const listed = settled === undefined ? active : [...active, settled];
  const selectedId = view.kind === "detail" ? view.sessionId : undefined;
  const selectedSession = useSession(selectedId ?? parentSessionId);

  const selected =
    selectedId === undefined
      ? undefined
      : (selectedSession.data ?? agents.find((agent) => agent.id === selectedId));

  const pendingAction = stop.isPending || stopAll.isPending;

  useLayoutEffect(() => {
    if (view.kind !== "list" || listed.length > 0) return;
    const held = root?.contains(document.activeElement) === true;
    onViewChange({ kind: "closed" });

    if (held) onRelease();
  }, [listed.length, onRelease, onViewChange, root, view.kind]);

  const close = (): void => {
    setStopCandidates(undefined);
    stop.reset();
    stopAll.reset();
    const held = root?.contains(document.activeElement) === true;
    onViewChange({ kind: "closed" });

    if (held) onRelease();
  };

  if (view.kind === "closed" && active.length === 0) return null;

  if (view.kind === "list" && listed.length === 0) return null;

  return (
    <div ref={ref} {...props(trayParts.root)}>
      {view.kind === "closed" && (
        <TrayPill
          label={`Agents, ${String(active.length)} active`}
          controls={trayId}
          onClick={() => onViewChange({ kind: "list", retainedSessionId: undefined })}
        >
          <span aria-hidden="true" {...props(trayParts.pillIndicator)}>
            {running.length > 0 ? (
              <StatusDot mark="working" />
            ) : (
              active.some((agent) => subagentTrayState(agent) === "attention") && (
                <span {...props(surfaceTheme.yellow, styles.attentionDot)} />
              )
            )}
          </span>
          <span>Agents</span>
          <span aria-hidden="true" {...props(trayParts.pillCount)}>
            {String(active.length)}
          </span>
        </TrayPill>
      )}
      <Tray
        open={view.kind !== "closed" && (view.kind === "detail" || listed.length > 0)}
        id={trayId}
        label={selectedId === undefined ? "Agents" : agentTitle(selected, selectedId)}
        focusKey={view.kind}
        onClose={close}
        xstyle={view.kind === "detail" && styles.detail(availableHeight)}
      >
        {pendingAction && (
          <div role="status" {...props(trayParts.notice)}>
            {stopAll.isPending ? "Stopping agents…" : "Stopping agent…"}
          </div>
        )}
        {view.kind === "list" && (
          <>
            <div {...props(trayStyles.header)}>
              <span {...props(trayStyles.title)}>Agents</span>
              {active.length > 0 && (
                <Button
                  aria-description={
                    stopCandidates === undefined
                      ? "Stop all active agents"
                      : `Confirm stopping ${String(stopCandidates.length)} active agents`
                  }
                  tone="danger"
                  loading={stopAll.isPending}
                  disabled={stop.isPending}
                  onClick={() => {
                    if (stopCandidates === undefined) {
                      setStopCandidates(active.map((agent) => agent.id));

                      return;
                    }

                    const candidates = new Set(stopCandidates);
                    stopAll.mutate(
                      active.filter((agent) => candidates.has(agent.id)).map((agent) => agent.id),
                    );
                    setStopCandidates(undefined);
                  }}
                >
                  Stop Agents
                </Button>
              )}
              <TrayIconAction icon="close" label="Close agents" onClick={close} />
            </div>
            {stopCandidates !== undefined && (
              <div role="status" {...props(trayParts.notice)}>
                Stop {String(stopCandidates.length)} active agents? Select Stop Agents again to stop
                them.
              </div>
            )}
            <div
              data-nyte-scrollport
              {...props(trayStyles.list, trayParts.listHeight(availableHeight))}
            >
              {listed.map((agent) => {
                const state = subagentTrayState(agent);

                return (
                  <Row key={agent.id} xstyle={trayParts.row} interactive>
                    <Row.Primary
                      aria-label={`Open ${agentTitle(agent, agent.id)}`}
                      onClick={() => {
                        setStopCandidates(undefined);
                        onViewChange({ kind: "detail", sessionId: agent.id });
                      }}
                    >
                      <Row.Leading aria-hidden="true">
                        {state === "attention" ? (
                          <span {...props(surfaceTheme.yellow, styles.attentionDot)} />
                        ) : (
                          state === "working" && <StatusDot mark="working" />
                        )}
                      </Row.Leading>
                      <Row.Label>{agentTitle(agent, agent.id)}</Row.Label>
                    </Row.Primary>
                    <Row.Meta>{TRAY_STATE_LABEL[state]}</Row.Meta>
                  </Row>
                );
              })}
            </div>
            {(stop.isError || stopAll.isError) && (
              <div role="alert" {...props(intent.danger, trayParts.notice, trayParts.error)}>
                Couldn’t stop the agent. Try again.
              </div>
            )}
          </>
        )}
        {view.kind === "detail" && selectedId !== undefined && (
          <>
            <div {...props(trayStyles.header)}>
              <TrayIconAction
                icon="arrow-left"
                label="Back to agents"
                onClick={() => onViewChange({ kind: "list", retainedSessionId: view.sessionId })}
              />
              <span title={agentTitle(selected, selectedId)} {...props(trayStyles.title)}>
                {agentTitle(selected, selectedId)}
              </span>
              {selected !== undefined && subagentTrayState(selected) !== "inactive" && (
                <Button
                  tone="danger"
                  loading={pendingAction}
                  onClick={() => stop.mutate(selectedId)}
                >
                  Stop Agent
                </Button>
              )}
              <TrayIconAction
                icon="expand"
                size={15}
                label="Open as full chat"
                onClick={() => onExpand(selectedId)}
              />
              <TrayIconAction icon="close" label="Close agents" onClick={close} />
            </div>
            <div {...props(styles.detailBody)}>{detail}</div>
            {stop.isError && (
              <div role="alert" {...props(intent.danger, trayParts.notice, trayParts.error)}>
                Couldn’t stop the agent. Try again.
              </div>
            )}
          </>
        )}
      </Tray>
    </div>
  );
}
