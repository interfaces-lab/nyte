import { create } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { CodeAction } from "@nyte-ai/schema";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuGroupLabel,
  ContextMenuItem,
} from "@nyte-ai/ui/context-menu";
import { Loader } from "@nyte-ai/ui/loader";

const styles = create({
  menu: { maxWidth: "min(640px, var(--available-width))" },
});

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
  const groups = [
    {
      label: "Quick Fixes",
      icon: "lightbulb" as const,
      actions: actions
        .filter((action) => action.kind === "quickfix")
        .toSorted((first, second) => Number(second.preferred) - Number(first.preferred)),
    },
    {
      label: "Refactor",
      icon: "pencil" as const,
      actions: actions.filter((action) => action.kind.startsWith("refactor")),
    },
  ].filter((group) => group.actions.length > 0);

  return (
    <ContextMenu open onOpenChange={(open) => !open && onClose()}>
      <ContextMenuContent
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={4}
        aria-busy={running !== undefined}
        xstyle={styles.menu}
      >
        {groups.map((group) => (
          <ContextMenuGroup key={group.label}>
            <ContextMenuGroupLabel>{group.label}</ContextMenuGroupLabel>
            {group.actions.map((action) => (
              <ContextMenuItem
                key={`${action.token.server}:${String(action.token.item)}`}
                icon={group.icon}
                closeOnClick={false}
                disabled={running !== undefined}
                meta={action === running ? <Loader /> : undefined}
                onClick={() => onPick(action)}
              >
                {action.title}
              </ContextMenuItem>
            ))}
          </ContextMenuGroup>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
