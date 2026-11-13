import { intent } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import { useEffectEvent, useId, useLayoutEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { childTitle, trayTasks } from "../../chats/index.ts";
import type { ChildTask, Task } from "../../chats/index.ts";
import { connection } from "../../data/connection.ts";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { TaskList, useStopTasks } from "./task-list.tsx";
import { pillCounts, Tray, TrayIconAction, TrayPill, trayParts, useTrayRoot } from "./tray.tsx";
import { useCommitCount } from "../../lib/work-counts.ts";
import { windowTabs } from "../../tabs/window-tabs.ts";
import type { TrayView } from "../../window/index.ts";

export type SubagentTrayView = Exclude<TrayView, { readonly kind: "terminals" }>;

const styles = create({
  detail: (height: number) => ({
    minHeight: 0,
    height: `min(70dvh, max(220px, ${String(height)}px))`,
  }),
  detailBody: { display: "flex", flex: 1, minHeight: 0, overflow: "clip" },
});

export function listAgents(
  tasks: readonly Task[],
  cleared: ReadonlySet<string>,
): readonly ChildTask[] {
  return trayTasks(
    tasks.filter((task): task is ChildTask => task.kind === "child"),
    cleared,
  );
}

function ReleaseOnEmpty({
  root,
  onRelease,
}: {
  readonly root: HTMLDivElement | null;
  readonly onRelease: () => void;
}): null {
  const release = useEffectEvent(onRelease);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- unmounts before the emptied tray's pill is removed or its content turns inert
  useLayoutEffect(
    () => () => {
      if (root?.contains(document.activeElement) === true) release();
    },
    [root],
  );

  return null;
}

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
  readonly agents: readonly ChildTask[];
  readonly view: SubagentTrayView;
  readonly onViewChange: (view: SubagentTrayView) => void;
  readonly onRelease: () => void;
  readonly viewport: HTMLElement | null;
  readonly detail: ReactNode;
}): ReactElement | null {
  useCommitCount("render:agents-tray");
  const { root, ref, availableHeight } = useTrayRoot(viewport);
  const trayId = useId();
  const stop = useStopTasks((sessionId: SessionId) => connection().session(sessionId).stop());
  const selectedId = view.kind === "detail" ? view.sessionId : undefined;
  const selected = agents.find((agent) => agent.id === selectedId);
  const selectedTitle = selected?.title ?? childTitle(undefined);

  const attachRoot = (element: HTMLDivElement): (() => void) => {
    ref(element);

    return () => {
      ref(null);

      if (element.contains(document.activeElement)) onRelease();
    };
  };

  const close = (): void => {
    stop.reset();
    const held = root?.contains(document.activeElement) === true;
    onViewChange({ kind: "closed" });

    if (held) onRelease();
  };

  const empty = view.kind !== "detail" && agents.length === 0;

  return (
    <div ref={attachRoot} {...props(trayParts.root)}>
      {!empty && <ReleaseOnEmpty root={root} onRelease={onRelease} />}
      {!empty && (
        <TrayPill
          icon="agent"
          title="Agents"
          description={`Agents, ${pillCounts(agents)}`}
          tasks={agents}
          expanded={view.kind !== "closed"}
          controls={trayId}
          onClick={() =>
            view.kind === "closed"
              ? onViewChange({ kind: "list", openedOver: agents.map((agent) => agent.id) })
              : close()
          }
        />
      )}
      <Tray
        open={view.kind !== "closed"}
        id={trayId}
        label={selectedId === undefined ? "Agents" : selectedTitle}
        focusKey={view.kind}
        onClose={close}
        xstyle={view.kind === "detail" && styles.detail(availableHeight)}
      >
        {view.kind === "list" && (
          <TaskList
            parent={parentSessionId}
            tasks={agents}
            noun="agents"
            label={(agent) => agent.title}
            maxHeight={availableHeight}
            stopping={stop.stopping}
            onStop={stop.run}
            onOpen={(agent) => onViewChange({ kind: "detail", sessionId: agent.id })}
          />
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
                <TrayIconAction
                  icon="square"
                  label="Stop Agent"
                  loading={stop.stopping.has(selectedId)}
                  onClick={() => stop.run([selectedId])}
                />
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
          </>
        )}
        {stop.failed && (
          <div role="alert" {...props(intent.danger, trayParts.notice, trayParts.error)}>
            Couldn’t stop the agent. Try again.
          </div>
        )}
      </Tray>
    </div>
  );
}
