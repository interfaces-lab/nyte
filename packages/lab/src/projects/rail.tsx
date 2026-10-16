/** The projects rail: this project's agents by state, then the other projects and loose chats. */
import { props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import type { SessionMark } from "@nyte-ai/plugin/client/presentation";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Shelf } from "../sidebar/rail";
import { ProjectFolder, type FolderDesign } from "./folder";
import { LOOSE_CHATS, OTHER_PROJECTS, type Agent } from "./timeline";
import { styles } from "./page.stylex";

export const PROJECT = "Dialog surface migration";

export function agentsIn(
  agents: ReadonlyMap<string, Agent>,
  state: Agent["state"],
): readonly Agent[] {
  return [...agents.values()].filter((agent) => agent.state === state);
}

export function stateLabel(agent: Agent): string {
  if (agent.state === "working") return "Working";

  const word = agent.state === "done" ? "Done" : "Archived";

  return agent.result === undefined ? word : `${word} · ${agent.result}`;
}

export function AgentGlyph({ agent }: { readonly agent: Agent }): ReactElement {
  const glyph =
    agent.state === "working" ? (
      <StatusDot mark="working" />
    ) : (
      <Icon
        name={agent.state === "done" ? "checkmark" : "archive"}
        size={14}
        label={agent.state === "done" ? "Done" : "Archived"}
      />
    );

  if (agent.place === "cloud") return glyph;

  return (
    <span title="This Mac" {...props(styles.sessionBadgeHost)}>
      {glyph}
      <span {...props(styles.sessionBadge)}>
        <Icon name="laptop" size={9} label="This Mac" />
      </span>
    </span>
  );
}

export function AgentRow({
  agent,
  open,
  onOpen,
}: {
  readonly agent: Agent;
  readonly open: boolean;
  readonly onOpen: () => void;
}): ReactElement {
  return (
    <Row
      interactive
      selected={open}
      xstyle={[
        sidebarStyles.rowSurface,
        styles.agentRow,
        agent.state === "archived" && styles.receded,
      ]}
    >
      <Row.Primary onClick={onOpen} title="Open as a tab">
        <Row.Leading xstyle={sidebarStyles.rowIcon}>
          <AgentGlyph agent={agent} />
        </Row.Leading>
        <Row.Label>{agent.task}</Row.Label>
        {agent.result !== undefined && (
          <Row.Meta xstyle={styles.agentResult}>{agent.result}</Row.Meta>
        )}
      </Row.Primary>
    </Row>
  );
}

function ProjectRow({
  name,
  mark,
  working,
  ask,
  selected,
  folder,
}: {
  readonly name: string;
  readonly mark: SessionMark;
  readonly working: number;
  readonly ask: string | undefined;
  readonly selected: boolean;
  readonly folder: FolderDesign;
}): ReactElement {
  const [hovering, setHovering] = useState(false);

  const titleLine = (
    <>
      <Row.Label xstyle={sidebarStyles.sessionLabel}>{name}</Row.Label>
      {working > 0 && (
        <Row.Meta
          xstyle={[sidebarStyles.rowMeta, styles.projectMeta]}
          title={`${String(working)} agents working`}
        >
          {mark === "idle" ? <Icon name="agent" size={12} /> : <StatusDot mark={mark} />}
          {working}
        </Row.Meta>
      )}
    </>
  );

  return (
    <Row
      selected={selected}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      xstyle={[
        sidebarStyles.rowSurface,
        sidebarStyles.sessionRow,
        selected && sidebarStyles.rowSelected,
        ask !== undefined && sidebarStyles.sessionRowAsk,
      ]}
    >
      {selected && <Row.Backdrop xstyle={sidebarStyles.sessionSelection} />}
      <Row.Primary aria-current={selected ? "page" : undefined}>
        <Row.Leading
          xstyle={[sidebarStyles.rowIcon, ask !== undefined && sidebarStyles.rowIconAsk]}
        >
          <ProjectFolder design={folder} open={selected} hovering={hovering} count={working} />
        </Row.Leading>
        {ask === undefined ? (
          titleLine
        ) : (
          <Row.Body>
            <span {...props(sidebarStyles.sessionTitleLine)}>{titleLine}</span>
            <Row.Description xstyle={[intent.warning, sidebarStyles.sessionAsk]}>
              {ask}
            </Row.Description>
          </Row.Body>
        )}
      </Row.Primary>
    </Row>
  );
}

export function Rail({
  mark,
  working,
  ask,
  folder,
}: {
  readonly mark: SessionMark;
  readonly working: number;
  readonly ask: string | undefined;
  readonly folder: FolderDesign;
}): ReactElement {
  return (
    <nav aria-label="Sidebar" {...props(sidebarStyles.rail, styles.rail)}>
      <div {...props(sidebarStyles.primaryActions)}>
        <Row variant="nav" xstyle={sidebarStyles.navRow}>
          <Row.Leading xstyle={sidebarStyles.navLeading}>
            <Icon name="new-chat" size={14} />
          </Row.Leading>
          <Row.Label>New Chat</Row.Label>
        </Row>
        <Row variant="nav" xstyle={sidebarStyles.navRow}>
          <Row.Leading xstyle={sidebarStyles.navLeading}>
            <Icon name="search" size={14} />
          </Row.Leading>
          <Row.Label>Search</Row.Label>
        </Row>
      </div>
      <div {...props(sidebarStyles.scroll, styles.railScroll)}>
        <section aria-label="Projects" {...props(sidebarStyles.section)}>
          <div {...props(sidebarStyles.sectionHeader)}>
            <span {...props(sidebarStyles.sectionToggle)}>
              <span {...props(sidebarStyles.sectionLabel)}>Projects</span>
            </span>
            <Button size="xs" iconOnly icon="folder-add" aria-label="New Project" />
          </div>
          <ProjectRow
            name={PROJECT}
            mark={mark}
            working={working}
            ask={ask}
            selected
            folder={folder}
          />
          {OTHER_PROJECTS.map((project) => (
            <ProjectRow
              key={project.id}
              name={project.name}
              mark={project.working > 0 ? "working" : "idle"}
              working={project.working}
              ask={undefined}
              selected={false}
              folder={folder}
            />
          ))}
        </section>
        <Shelf
          label="Chats"
          count={LOOSE_CHATS.length}
          leading={<Icon name="new-chat" size={14} />}
        >
          {LOOSE_CHATS.map((title) => (
            <Row key={title} xstyle={[sidebarStyles.rowSurface, sidebarStyles.sessionRow]}>
              <Row.Primary>
                <Row.Leading xstyle={sidebarStyles.rowIcon} />
                <Row.Label>{title}</Row.Label>
              </Row.Primary>
            </Row>
          ))}
        </Shelf>
      </div>
    </nav>
  );
}
