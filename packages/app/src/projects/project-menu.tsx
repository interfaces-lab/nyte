import type { ReactElement } from "react";
import type { ProjectId, WorkspaceId } from "@nyte-ai/schema";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { useProjects } from "../data/projects.ts";
import { useSetting, preferences } from "../preferences/index.ts";
import { ContextTrigger } from "../panes/context-selector.tsx";
import { contextStyles } from "../panes/context-selector.stylex.ts";

const NONE = "";

/**
 * Picks the project a new chat starts in, among the folder's own. It shows only when projects are
 * on and the folder has one; a choice from another folder reads as none.
 */
export function ProjectMenu({
  folder,
  value,
  onChange,
}: {
  readonly folder: WorkspaceId | undefined;
  readonly value: ProjectId | undefined;
  readonly onChange: (project: ProjectId | undefined) => void;
}): ReactElement | null {
  const enabled = useSetting(preferences.projects);
  const here = useProjects().filter((project) => project.workspace === folder);
  const current = here.find((project) => project.id === value);

  if (!enabled || here.length === 0) return null;

  return (
    <Menu>
      <MenuTrigger
        render={<ContextTrigger size="md" icon="layers" value={current?.name ?? "No Project"} />}
      />
      <MenuContent side="top" xstyle={contextStyles.menu}>
        <MenuRadioGroup
          value={current?.id ?? NONE}
          onValueChange={(next) => onChange(here.find((project) => project.id === next)?.id)}
        >
          <MenuRadioItem value={NONE} icon="new-chat">
            No Project
          </MenuRadioItem>
          {here.map((project) => (
            <MenuRadioItem key={project.id} value={project.id} icon="layers">
              {project.name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
