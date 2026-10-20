/**
 * The project switcher: a palette of only projects, opened from the project's
 * own name, ordering what needs you first.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { Command } from "@nyte-ai/ui/command";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { button, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { ProjectGlyph, projectMark } from "./appearance";
import type { ProjectListing } from "./timeline";

export type SwitcherPlacement = "rail" | "titlebar";

const NEW_PROJECT = "action:new";

function rowMeta(project: ProjectListing, current: boolean): string {
  if (current) return "Current";

  if (project.ask !== undefined) return "Needs you";

  return project.working > 0 ? `${String(project.working)} working` : project.updated;
}

function ProjectItem({
  project,
  current,
  onSelect,
}: {
  readonly project: ProjectListing;
  readonly current: boolean;
  readonly onSelect: (id: string) => void;
}): ReactElement {
  return (
    <Command.Item
      value={project.id}
      leading={
        <ProjectGlyph appearance={project.appearance} mark={projectMark(project)} surface="popup" />
      }
      meta={rowMeta(project, current)}
      onClick={() => onSelect(project.id)}
    >
      {project.name}
      {project.ask !== undefined && <span {...props(styles.ask)}> · {project.ask}</span>}
    </Command.Item>
  );
}

export function ProjectSwitcher({
  open,
  placement,
  projects,
  currentId,
  chats,
  onOpenChange,
  onSelect,
  onNewProject,
}: {
  readonly open: boolean;
  readonly placement: SwitcherPlacement;
  readonly projects: readonly ProjectListing[];
  readonly currentId: string;
  /** Chats outside every project, found by search only. */
  readonly chats: readonly string[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (id: string) => void;
  readonly onNewProject: (name: string) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const current = projects.find((project) => project.id === currentId) ?? projects[0];
  const needle = query.trim().toLowerCase();
  const matches = (text: string): boolean => text.toLowerCase().includes(needle);

  const shown = projects.filter(
    (project) => matches(project.name) && (needle !== "" || project.id !== currentId),
  );

  const needsYou = shown.filter((project) => project.ask !== undefined);
  const others = shown.filter((project) => project.ask === undefined);
  const foundChats = needle === "" ? [] : chats.filter(matches);

  const items = [
    ...needsYou.map((project) => project.id),
    ...others.map((project) => project.id),
    ...foundChats.map((title) => `chat:${title}`),
    NEW_PROJECT,
  ];

  const choose = (run: () => void): void => {
    onOpenChange(false);
    setQuery("");
    run();
  };

  const select = (id: string): void => choose(() => onSelect(id));
  const rail = placement === "rail";

  return (
    <Command.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);

        if (!next) setQuery("");
      }}
    >
      <Command.Trigger
        render={
          <button
            type="button"
            aria-keyshortcuts="Alt+P"
            {...props(styles.trigger, rail ? styles.triggerRail : styles.triggerTitlebar)}
          />
        }
      >
        {current !== undefined && (
          <>
            <ProjectGlyph
              appearance={current.appearance}
              mark={projectMark(current)}
              surface="sidebar"
            />
            <span {...props(styles.triggerName)}>{current.name}</span>
          </>
        )}
        <span {...props(styles.triggerChevron)}>
          <Icon name="chevron-up-down" size={12} />
        </span>
      </Command.Trigger>
      <Command.Popup
        title="Switch project"
        items={items}
        value={query}
        onValueChange={(value) => setQuery(value)}
      >
        <Command.Input
          aria-label="Search projects"
          placeholder="Switch project…"
          trailing={<Kbd keys={["⌥", "P"]} />}
        />
        <Command.List aria-label="Projects">
          {needsYou.length > 0 && (
            <Command.Group heading="Needs you">
              {needsYou.map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  current={project.id === currentId}
                  onSelect={select}
                />
              ))}
            </Command.Group>
          )}
          {others.length > 0 && (
            <Command.Group heading="Projects">
              {others.map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  current={project.id === currentId}
                  onSelect={select}
                />
              ))}
            </Command.Group>
          )}
          {foundChats.length > 0 && (
            <Command.Group heading="Chats outside a project">
              {foundChats.map((title) => (
                <Command.Item
                  key={title}
                  value={`chat:${title}`}
                  leading={<Icon name="new-chat" size={16} />}
                  meta="Make a project"
                  onClick={() => choose(() => onNewProject(title))}
                >
                  {title}
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="Actions">
            <Command.Item
              value={NEW_PROJECT}
              leading={<Icon name="folder-add" size={16} />}
              onClick={() => choose(() => onNewProject(query.trim()))}
            >
              {needle === "" ? "New Project" : `New Project “${query.trim()}”`}
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command.Popup>
    </Command.Root>
  );
}

const styles = create({
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    margin: 0,
    borderStyle: "none",
    borderRadius: button.radiusMd,
    backgroundColor: {
      default: "transparent",
      ":hover": role.bgHover,
      ":focus-visible": role.bgHover,
      "[data-popup-open]": role.bgPressed,
    },
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
    fontWeight: 600,
    lineHeight: type.leadingSm,
    textAlign: "start",
    cursor: "default",
    outline: "none",
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
  },
  triggerRail: {
    width: "100%",
    height: button.heightLg,
    paddingInline: 8,
  },
  triggerTitlebar: {
    flexShrink: 1,
    maxWidth: 220,
    height: button.heightSm,
    paddingInline: 6,
    borderRadius: radius.control,
  },
  triggerName: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  triggerChevron: { display: "grid", flexShrink: 0, color: role.contentTertiary },
  ask: { color: role.contentTertiary },
});
