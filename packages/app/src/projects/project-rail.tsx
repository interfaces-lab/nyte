import type { ProjectInfo, SessionId } from "@nyte-ai/schema";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { useChatTasks } from "../chats/index.ts";
import type { ChildTask } from "../chats/index.ts";
import { TaskMark } from "../components/task-mark.tsx";
import { useProjects } from "../data/projects.ts";
import { useSessionRow } from "../data/session-rows.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { chatWindow } from "../window/index.ts";
import { workbenchStyles } from "../workbench/workbench.stylex.ts";
import { openProjectDialog } from "./project-dialog.tsx";

const RANK: Record<TaskState, number> = {
  waiting: 0,
  failed: 1,
  retrying: 2,
  working: 2,
  background: 2,
  done: 3,
};

export function ProjectRail({ sessionId }: { readonly sessionId: SessionId }): ReactElement | null {
  const id = useSessionRow(sessionId, (session) => session.project);
  const project = useProjects().find((entry) => entry.id === id);

  if (project === undefined) return null;

  return <ProjectAgents project={project} />;
}

function ProjectAgents({ project }: { readonly project: ProjectInfo }): ReactElement {
  const coordinator = project.coordinator ?? undefined;

  const agents = useChatTasks(coordinator).filter(
    (task): task is ChildTask => task.kind === "child",
  );

  const going = agents
    .filter((agent) => agent.state !== "done")
    .toSorted((left, right) => RANK[left.state] - RANK[right.state]);

  const done = agents.filter((agent) => agent.state === "done");

  return (
    <section aria-label={`${project.name} agents`} {...props(workbenchStyles.railSection)}>
      <div {...props(workbenchStyles.railHeading)}>
        <span {...props(workbenchStyles.railHeadingText)}>Agents</span>
        <Button
          size="sm"
          iconOnly
          icon="settings"
          aria-label={`${project.name} Settings`}
          onClick={() => openProjectDialog(project.id)}
        />
      </div>
      {going.map((agent) => (
        <Row
          key={agent.id}
          interactive
          xstyle={[text.base, workbenchStyles.railRow, workbenchStyles.railRowInteractive]}
        >
          <Row.Primary onClick={() => windowTabs.openChat(agent.id, "next-to-parent")}>
            <Row.Leading>
              <TaskMark state={agent.state} />
            </Row.Leading>
            <Row.Label
              xstyle={[
                workbenchStyles.railLabel,
                agent.state !== "working" && workbenchStyles.railValue,
              ]}
            >
              {agent.title}
            </Row.Label>
            {agent.state === "waiting" && (
              <span {...props(workbenchStyles.railDetail)}>Needs you</span>
            )}
            {agent.state === "failed" && <span {...props(workbenchStyles.railDetail)}>Failed</span>}
          </Row.Primary>
        </Row>
      ))}
      {done.length > 0 && coordinator !== undefined && (
        <Row
          interactive
          xstyle={[text.base, workbenchStyles.railRow, workbenchStyles.railRowInteractive]}
        >
          <Row.Primary
            onClick={() => {
              windowTabs.openChat(coordinator, "permanent");
              chatWindow.act({
                kind: "tray",
                parent: coordinator,
                view: { kind: "list", openedOver: done.map((agent) => agent.id) },
              });
            }}
          >
            <Row.Leading>
              <Icon name="checkmark" size="sm" />
            </Row.Leading>
            <Row.Label
              xstyle={workbenchStyles.railLabel}
            >{`${String(done.length)} done`}</Row.Label>
          </Row.Primary>
        </Row>
      )}
    </section>
  );
}
