import type { ProjectInfo, SessionId } from "@nyte-ai/schema";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { useChatTasks } from "../chats/index.ts";
import { TaskMark } from "../components/task-mark.tsx";
import { useProjects } from "../data/projects.ts";
import { useSessionRow } from "../data/session-rows.ts";
import { workbenchStyles } from "../workbench/workbench.stylex.ts";
import { openProject } from "./open-project.ts";
import { openProjectDialog } from "./project-dialog.tsx";

const styles = create({
  counts: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    marginInlineStart: "auto",
    flexShrink: 0,
  },
  count: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    color: role.contentTertiary,
    fontVariantNumeric: "tabular-nums",
  },
});

/** Most urgent first, so what needs a look leads. */
const SHOWN = ["waiting", "failed", "working", "done"] as const;

/**
 * The workbench rail's project row beside a chat in a project: its name, which opens the
 * coordinator, a count of its agents per state, and its settings.
 */
export function ProjectRail({ sessionId }: { readonly sessionId: SessionId }): ReactElement | null {
  const id = useSessionRow(sessionId, (session) => session.project);
  const project = useProjects().find((entry) => entry.id === id);

  if (project === undefined) return null;

  return (
    <Row xstyle={[text.base, workbenchStyles.railRow, workbenchStyles.railRowInteractive]}>
      <Row.Primary onClick={() => void openProject(project)}>
        <Row.Leading>
          <Icon name="layers" size="sm" />
        </Row.Leading>
        <Row.Label xstyle={workbenchStyles.railLabel}>{project.name}</Row.Label>
        <AgentCounts project={project} />
      </Row.Primary>
      <Row.Actions xstyle={workbenchStyles.railActions}>
        <Button
          size="sm"
          iconOnly
          icon="settings"
          aria-label={`${project.name} Settings`}
          onClick={() => openProjectDialog(project.id)}
        />
      </Row.Actions>
    </Row>
  );
}

function AgentCounts({ project }: { readonly project: ProjectInfo }): ReactElement | null {
  const agents = useChatTasks(project.coordinator ?? undefined).filter(
    (task) => task.kind === "child",
  );

  const counts = SHOWN.flatMap((state) => {
    const count = agents.filter((agent) => shownState(agent.state) === state).length;

    return count === 0 ? [] : [{ state, count }];
  });

  if (counts.length === 0) return null;

  return (
    <span {...props(styles.counts)}>
      {counts.map((entry) => (
        <span key={entry.state} {...props(text.sm, styles.count)}>
          {entry.state === "done" ? (
            <Icon name="checkmark" size="xs" label="Done" />
          ) : (
            <TaskMark state={entry.state} />
          )}
          {entry.count}
        </span>
      ))}
    </span>
  );
}

function shownState(state: TaskState): (typeof SHOWN)[number] {
  switch (state) {
    case "retrying":
    case "background":
      return "working";
    default:
      return state;
  }
}
