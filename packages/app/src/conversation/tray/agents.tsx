import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { Row } from "@nyte-ai/ui/row";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { runMark } from "@nyte-ai/plugin/client/presentation";
import type { RunStatus, SessionMark } from "@nyte-ai/plugin/client/presentation";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { useChats } from "../../chats/index.ts";
import type { ChatDirectory } from "../../chats/index.ts";
import { StatusDot } from "../../components/ui.tsx";
import { Button } from "@nyte-ai/ui/button";
import { useChildSessions } from "../../queries.ts";
import { connection } from "../../sdk.tsx";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { Tray, TrayIconAction, TrayPill, trayParts, useTrayRoot } from "./tray.tsx";
import { useCommitCount } from "../../work-counts.ts";

export type SubagentTrayView =
  | { readonly kind: "closed" }
  | { readonly kind: "list"; readonly retainedSessionId: SessionId | undefined }
  | { readonly kind: "detail"; readonly sessionId: SessionId };

const STATUS_LABEL = {
  idle: "Idle",
  working: "Working",
  retrying: "Retrying",
  "subagent-working": "Working",
  "waiting-for-approval": "Needs attention",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
} as const satisfies Readonly<Record<RunStatus["kind"], string>>;

interface ListedAgent {
  readonly session: SessionInfo;
  readonly title: string;
  readonly status: RunStatus;
  readonly mark: SessionMark;
}

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

/** The agents the tray lists: those running or waiting on the user, then failed ones, and the one it holds open. */
export function listSubagents(
  agents: readonly SessionInfo[],
  view: SubagentTrayView,
  chats: ChatDirectory,
) {
  const pinnedId =
    view.kind === "detail"
      ? view.sessionId
      : view.kind === "list"
        ? view.retainedSessionId
        : undefined;

  const known = agents.flatMap((session): readonly ListedAgent[] => {
    const chat = chats.get(session.id);

    return chat === undefined
      ? []
      : [{ session, title: chat.title, status: chat.status, mark: runMark(chat.status) }];
  });

  const shown = known
    .filter((agent) => agent.mark !== "idle")
    .toSorted(
      (left, right) =>
        Number(left.mark !== "waiting") - Number(right.mark !== "waiting") ||
        right.session.lastActivityAt - left.session.lastActivityAt ||
        left.session.id.localeCompare(right.session.id),
    );

  const active = shown.filter((agent) => agent.mark !== "failed");

  const settled = known.find((agent) => agent.session.id === pinnedId && agent.mark === "idle");

  return { active, listed: settled === undefined ? shown : [...shown, settled] };
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
  const chats = useChats((directory) => directory);
  const { root, ref, availableHeight } = useTrayRoot(viewport);
  const trayId = useId();
  const [stopCandidates, setStopCandidates] = useState<readonly SessionId[]>();

  const stop = useMutation({
    mutationFn: (sessionId: SessionId) => connection().session(sessionId).stop(),
  });

  const stopAll = useMutation({
    mutationFn: (sessionIds: readonly SessionId[]) =>
      Promise.all(sessionIds.map((sessionId) => connection().session(sessionId).stop())),
  });

  const roster = listSubagents(agents, view, chats);
  const active = roster.active;
  const listed = roster.listed;
  const failed = listed.length - active.length;
  const selectedId = view.kind === "detail" ? view.sessionId : undefined;
  const selected = selectedId === undefined ? undefined : chats.get(selectedId);
  const selectedTitle = selected?.title ?? "Subagent";

  const selectedMark = selected === undefined ? "idle" : runMark(selected.status);

  const pendingAction = stop.isPending || stopAll.isPending;

  const attachRoot = (element: HTMLDivElement): (() => void) => {
    ref(element);

    return () => {
      ref(null);

      if (element.contains(document.activeElement)) onRelease();
    };
  };

  const close = (): void => {
    setStopCandidates(undefined);
    stop.reset();
    stopAll.reset();
    const held = root?.contains(document.activeElement) === true;
    onViewChange({ kind: "closed" });

    if (held) onRelease();
  };

  if (view.kind === "closed" && listed.length === 0) return null;

  if (view.kind === "list" && listed.length === 0) return null;

  return (
    <div ref={attachRoot} {...props(trayParts.root)}>
      {view.kind === "closed" && (
        <TrayPill
          label={`Agents, ${String(active.length)} active${failed === 0 ? "" : `, ${String(failed)} failed`}`}
          controls={trayId}
          onClick={() => onViewChange({ kind: "list", retainedSessionId: undefined })}
        >
          <span aria-hidden="true" {...props(trayParts.pillIndicator)}>
            {active.some((agent) => agent.mark !== "waiting") ? (
              <StatusDot mark="working" />
            ) : active.length > 0 ? (
              <span {...props(surfaceTheme.yellow, styles.attentionDot)} />
            ) : (
              <StatusDot mark="failed" />
            )}
          </span>
          <span>Agents</span>
          <span aria-hidden="true" {...props(trayParts.pillCount)}>
            {String(listed.length)}
          </span>
        </TrayPill>
      )}
      <Tray
        open={view.kind !== "closed" && (view.kind === "detail" || listed.length > 0)}
        id={trayId}
        label={selectedId === undefined ? "Agents" : selectedTitle}
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
                      setStopCandidates(active.map((agent) => agent.session.id));

                      return;
                    }

                    const candidates = new Set(stopCandidates);
                    stopAll.mutate(
                      active.flatMap((agent) =>
                        candidates.has(agent.session.id) ? [agent.session.id] : [],
                      ),
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
                const title = agent.title;

                return (
                  <Row key={agent.session.id} xstyle={trayParts.row} interactive>
                    <Row.Primary
                      aria-label={`Open ${title}`}
                      onClick={() => {
                        setStopCandidates(undefined);
                        onViewChange({ kind: "detail", sessionId: agent.session.id });
                      }}
                    >
                      <Row.Leading aria-hidden="true">
                        {agent.mark === "waiting" ? (
                          <span {...props(surfaceTheme.yellow, styles.attentionDot)} />
                        ) : (
                          <StatusDot mark={runMark(agent.status)} />
                        )}
                      </Row.Leading>
                      <Row.Label>{title}</Row.Label>
                    </Row.Primary>
                    <Row.Meta>{STATUS_LABEL[agent.status.kind]}</Row.Meta>
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
              <span title={selectedTitle} {...props(trayStyles.title)}>
                {selectedTitle}
              </span>
              {selectedMark !== "idle" && selectedMark !== "failed" && (
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
