import { intent } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import { Row } from "@nyte-ai/ui/row";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { taskEnded, taskLabel } from "@nyte-ai/plugin/client/presentation";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import type { SessionId } from "@nyte-ai/sdk";
import { childTitle, trayTasks } from "../../chats/index.ts";
import type { ChildTask, Task } from "../../chats/index.ts";
import { TaskMark } from "../../components/task-mark.tsx";
import { Button } from "@nyte-ai/ui/button";
import { connection } from "../../data/connection.ts";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { Tray, TrayIconAction, TrayPill, trayParts, useTrayRoot } from "./tray.tsx";
import { useCommitCount } from "../../lib/work-counts.ts";
import { windowTabs } from "../../tabs/window-tabs.ts";
import { chatWindow, useChatWindow } from "../../window/index.ts";
import type { TrayView } from "../../window/index.ts";

export type SubagentTrayView = Exclude<TrayView, { readonly kind: "terminals" }>;

const styles = create({
  detail: (height: number) => ({
    minHeight: 0,
    height: `min(70dvh, max(220px, ${String(height)}px))`,
  }),
  detailBody: { display: "flex", flex: 1, minHeight: 0, overflow: "clip" },
});

/** The agents a chat's tray lists, by the one tray rule. */
export function listAgents(
  tasks: readonly Task[],
  cleared: ReadonlySet<string>,
): readonly ChildTask[] {
  return trayTasks(
    tasks.filter((task): task is ChildTask => task.kind === "child"),
    cleared,
  );
}

/** The one mark a pill draws for what it lists: work still going, then work waiting on the user, then a failure. */
export function pillState(tasks: readonly Task[]): TaskState {
  const states = tasks.map((task) => task.state);

  if (states.some((state) => state === "working" || state === "retrying" || state === "background"))
    return "working";

  if (states.includes("waiting")) return "waiting";

  return states.includes("failed") ? "failed" : "done";
}

/** How a pill counts what it lists: those still going, then those ended, by how they ended. */
export function pillCounts(tasks: readonly Task[]): string {
  const going = tasks.filter((task) => !taskEnded(task.state)).length;
  const failed = tasks.filter((task) => task.state === "failed").length;
  const done = tasks.length - going - failed;

  return [
    `${String(going)} active`,
    ...(done === 0 ? [] : [`${String(done)} ${taskLabel("done").toLowerCase()}`]),
    ...(failed === 0 ? [] : [`${String(failed)} ${taskLabel("failed").toLowerCase()}`]),
  ].join(", ");
}

/**
 * The chat's agents over its composer: a pill, the list, and one agent's chat as a preview. Every
 * agent still going is listed, and each ended one until the user clears it.
 */
export function SubagentTray({
  parentSessionId,
  agents,
  view,
  onViewChange,
  onRelease,
  viewport,
  detail,
}: {
  readonly parentSessionId: SessionId;
  /** The agents the tray lists. */
  readonly agents: readonly ChildTask[];
  readonly view: SubagentTrayView;
  readonly onViewChange: (view: SubagentTrayView) => void;
  readonly onRelease: () => void;
  readonly viewport: HTMLElement | null;
  readonly detail: ReactNode;
}): ReactElement | null {
  useCommitCount("render:agents-tray");
  const unread = useChatWindow((snapshot) => snapshot.unread);
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

  const live = agents.filter((agent) => agent.live);
  const ended = agents.filter((agent) => taskEnded(agent.state));
  const selectedId = view.kind === "detail" ? view.sessionId : undefined;
  const selected = agents.find((agent) => agent.id === selectedId);
  const selectedTitle = selected?.title ?? childTitle(undefined);
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

  if (view.kind !== "detail" && agents.length === 0) return null;

  return (
    <div ref={attachRoot} {...props(trayParts.root)}>
      {view.kind === "closed" && (
        <TrayPill
          label={`Agents, ${pillCounts(agents)}`}
          controls={trayId}
          onClick={() =>
            onViewChange({ kind: "list", openedOver: agents.map((agent) => agent.id) })
          }
        >
          <span aria-hidden="true" {...props(trayParts.pillIndicator)}>
            <TaskMark state={pillState(agents)} />
          </span>
          <span>Agents</span>
          <span aria-hidden="true" {...props(trayParts.pillCount)}>
            {String(agents.length)}
          </span>
        </TrayPill>
      )}
      <Tray
        open={view.kind !== "closed"}
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
              {ended.length > 0 && (
                <Button
                  onClick={() =>
                    chatWindow.act({
                      kind: "clear",
                      parent: parentSessionId,
                      tasks: ended.map((agent) => agent.id),
                    })
                  }
                >
                  Clear Finished
                </Button>
              )}
              {live.length > 0 && (
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
                      setStopCandidates(live.map((agent) => agent.id));

                      return;
                    }

                    const candidates = new Set(stopCandidates);
                    stopAll.mutate(
                      live.flatMap((agent) => (candidates.has(agent.id) ? [agent.id] : [])),
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
              {agents.map((agent) => (
                <Row key={agent.id} xstyle={trayParts.row} interactive>
                  <Row.Primary
                    aria-label={`Open ${agent.title}`}
                    onClick={() => {
                      setStopCandidates(undefined);
                      onViewChange({ kind: "detail", sessionId: agent.id });
                    }}
                  >
                    <Row.Leading aria-hidden="true">
                      <TaskMark state={agent.state} unread={unread.has(agent.id)} />
                    </Row.Leading>
                    <Row.Label>{agent.title}</Row.Label>
                  </Row.Primary>
                  <Row.Meta>{taskLabel(agent.state)}</Row.Meta>
                </Row>
              ))}
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
                onClick={() =>
                  onViewChange({ kind: "list", openedOver: agents.map((agent) => agent.id) })
                }
              />
              <span title={selectedTitle} {...props(trayStyles.title)}>
                {selectedTitle}
              </span>
              {selected?.live === true && (
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
                label="Open as full chat"
                onClick={() => {
                  onViewChange({ kind: "closed" });
                  windowTabs.openChat(selectedId, "next-to-parent");
                }}
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
