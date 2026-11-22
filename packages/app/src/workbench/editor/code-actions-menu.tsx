import type { ReactElement } from "react";
import type { CodeAction } from "@nyte-ai/schema";
import { Loader } from "@nyte-ai/ui/loader";
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem } from "@nyte-ai/ui/menu";

export function CodeActionsMenu({
  anchor,
  actions,
  running,
  onPick,
  onClose,
}: {
  readonly anchor: { readonly getBoundingClientRect: () => DOMRect };
  readonly actions: readonly CodeAction[];
  readonly running: CodeAction | undefined;
  readonly onPick: (action: CodeAction) => void;
  readonly onClose: () => void;
}): ReactElement {
  const fixes = actions
    .filter((action) => action.kind === "quickfix")
    .toSorted((first, second) => Number(second.preferred) - Number(first.preferred));

  const groups = [
    { label: "Quick Fixes", actions: fixes },
    { label: "Refactor", actions: actions.filter((action) => action.kind.startsWith("refactor")) },
  ].filter((group) => group.actions.length > 0);

  return (
    <Menu open onOpenChange={(open) => !open && onClose()}>
      <MenuContent anchor={anchor} align="start" sideOffset={4} aria-busy={running !== undefined}>
        {groups.map((group) => (
          <MenuGroup key={group.label}>
            <MenuGroupLabel>{group.label}</MenuGroupLabel>
            {group.actions.map((action) => (
              <MenuItem
                key={action.token.item}
                layout="plain"
                closeOnClick={false}
                disabled={running !== undefined || action.disabled !== null}
                meta={action === running ? <Loader /> : action.disabled}
                onClick={() => onPick(action)}
              >
                {action.title}
              </MenuItem>
            ))}
          </MenuGroup>
        ))}
      </MenuContent>
    </Menu>
  );
}
