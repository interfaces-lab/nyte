import { copyTerminal, clearTerminal } from "./terminal-runtime.ts";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui";
import { Tabs } from "@nyte-ai/ui/primitives";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { errorMessage } from "../../../shared/errors.ts";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { Icon } from "../components/icons.tsx";
import type { IconName } from "../components/icons.tsx";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  Menu,
  MenuItem,
} from "../components/menu.tsx";
import { focus, IconButton } from "../components/ui.tsx";
import { t } from "../theme/vars.stylex.ts";
import {
  activeWorkbenchTab,
  workbenchController,
  workbenchTabAvailable,
  workbenchTabLabel,
  workbenchTabs,
} from "./controller.ts";
import type {
  WorkbenchScope,
  WorkbenchTabId,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "./controller.ts";
import { getTerminals, terminalActions, useTerminals } from "./terminal-store.ts";
import type { TerminalTab } from "./terminal-store.ts";

const styles = stylex.create({
  root: { display: "flex", alignItems: "center", gap: 3, flex: 1, minWidth: 0 },
  tabs: { display: "flex", minWidth: 0, overflowX: "auto", scrollbarWidth: "none" },
  list: { display: "flex", alignItems: "center", gap: 3, minWidth: 0 },
  item: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    maxWidth: 180,
    height: 24,
    borderRadius: t.radiusBase,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.textTertiary,
  },
  active: { backgroundColor: t.fillGhostSelected, color: t.textPrimary },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    height: "100%",
    paddingInlineStart: 7,
    paddingInlineEnd: 4,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: "transparent",
    color: "inherit",
    fontSize: t.fontSm,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  close: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 20,
    height: 20,
    marginInlineEnd: 2,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostSelected },
    color: t.iconSecondary,
    cursor: "pointer",
  },
});

const tabIcons = {
  changes: "git-branch",
  browser: "globe",
  terminal: "console",
} satisfies Record<WorkbenchTabId, IconName>;

type StripTab =
  | { readonly kind: "panel"; readonly panel: Exclude<WorkbenchTabId, "terminal"> }
  | { readonly kind: "terminal"; readonly terminal: TerminalTab };

type TerminalCloseState =
  | { readonly kind: "closed" }
  | {
      readonly kind: "confirming";
      readonly terminal: TerminalTab;
      readonly error: string | undefined;
    }
  | { readonly kind: "closing"; readonly terminal: TerminalTab };

function tabValue(tab: StripTab): string {
  return tab.kind === "panel" ? tab.panel : tab.terminal.id;
}

function tabLabel(tab: StripTab): string {
  return tab.kind === "panel" ? workbenchTabLabel(tab.panel) : tab.terminal.title;
}

/** The only workbench tab strip, rendered in the window titlebar. */
export function WorkbenchTabStrip({
  viewKey,
  view,
  scope,
  workspacePath,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly view: WorkbenchViewState;
  readonly scope: WorkbenchScope;
  readonly workspacePath: string | null;
}): ReactElement {
  const terminals = useTerminals(viewKey);
  const stripRef = useRef<HTMLDivElement>(null);
  const terminalCloseRef = useRef<HTMLButtonElement>(null);
  const [terminalClose, setTerminalClose] = useState<TerminalCloseState>({ kind: "closed" });
  const tabs = view.openTabs.flatMap<StripTab>((tab) => {
    if (!workbenchTabAvailable(scope, tab)) return [];
    return tab === "terminal"
      ? terminals.tabs.map((terminal) => ({ kind: "terminal", terminal }))
      : [{ kind: "panel", panel: tab }];
  });
  const activePanel = activeWorkbenchTab(view, scope);
  const activeValue = activePanel === "terminal" ? terminals.activeId : activePanel;

  const focusSelectedTab = (): void => {
    requestAnimationFrame(() => {
      const selected = stripRef.current?.querySelector('[role="tab"][aria-selected="true"]');
      if (selected instanceof HTMLElement) selected.focus();
      else document.getElementById("workbench-toggle")?.focus();
    });
  };
  const closeTerminal = async (terminal: TerminalTab): Promise<void> => {
    setTerminalClose({ kind: "closing", terminal });
    try {
      await terminalActions.close(terminal.id);
      if (getTerminals(viewKey).length === 0)
        workbenchController.actions.closeTab(viewKey, "terminal");
      setTerminalClose({ kind: "closed" });
      focusSelectedTab();
    } catch (cause: unknown) {
      setTerminalClose({ kind: "confirming", terminal, error: errorMessage(cause) });
    }
  };
  const closeTab = (tab: StripTab): void => {
    if (tab.kind === "terminal") {
      if (tab.terminal.state.kind === "running" || tab.terminal.state.kind === "starting") {
        setTerminalClose({ kind: "confirming", terminal: tab.terminal, error: undefined });
      } else void closeTerminal(tab.terminal);
    } else {
      workbenchController.actions.closeTab(viewKey, tab.panel);
      focusSelectedTab();
    }
  };

  return (
    <div ref={stripRef} {...stylex.props(styles.root)}>
      <Tabs.Root
        value={activeValue}
        {...stylex.props(styles.tabs)}
        onValueChange={(value) => {
          const next = tabs.find((tab) => tabValue(tab) === value);
          if (next === undefined) return;
          if (next.kind === "terminal") terminalActions.select(viewKey, next.terminal.id);
          workbenchController.actions.openTab(
            viewKey,
            next.kind === "panel" ? next.panel : "terminal",
          );
        }}
      >
        <Tabs.List aria-label="Workbench tabs" {...stylex.props(styles.list)}>
          {tabs.map((tab) => {
            const value = tabValue(tab);
            const label = tabLabel(tab);
            const panel = tab.kind === "panel" ? tab.panel : "terminal";
            const trigger = (
              <div
                key={value}
                role="presentation"
                {...stylex.props(styles.item, activeValue === value && styles.active)}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    closeTab(tab);
                  }
                }}
              >
                <Tabs.Tab
                  id={`${viewKey}-tab-${value}`}
                  value={value}
                  title={tab.kind === "terminal" ? tab.terminal.cwd : label}
                  aria-controls={`${viewKey}-panel-${panel}`}
                  {...stylex.props(styles.tab, focus.ringInset)}
                  onFocus={(event) =>
                    event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Delete") {
                      event.preventDefault();
                      closeTab(tab);
                    }
                  }}
                >
                  <Icon name={tabIcons[panel]} size={13} />
                  <span {...stylex.props(styles.label)}>{label}</span>
                </Tabs.Tab>
                <Button
                  unstyled
                  type="button"
                  ref={
                    tab.kind === "terminal" && activeValue === value ? terminalCloseRef : undefined
                  }
                  tabIndex={activeValue === value ? 0 : -1}
                  aria-label={`Close ${label} tab`}
                  title={`Close ${label} tab`}
                  {...stylex.props(styles.close, focus.ringInset)}
                  onClick={(event) => {
                    terminalCloseRef.current = event.currentTarget;
                    closeTab(tab);
                  }}
                >
                  <Icon name="x" size={12} />
                </Button>
              </div>
            );
            return tab.kind === "terminal" ? (
              <ContextMenu key={value} label={`${label} actions`} trigger={trigger}>
                <ContextMenuItem
                  icon="console"
                  onSelect={() => {
                    void terminalActions.create(viewKey, workspacePath);
                    workbenchController.actions.openTab(viewKey, "terminal");
                  }}
                >
                  New Terminal
                </ContextMenuItem>
                <ContextMenuItem
                  icon="copy"
                  onSelect={() => {
                    copyTerminal(tab.terminal.id);
                  }}
                >
                  Copy Selection
                </ContextMenuItem>
                <ContextMenuItem
                  icon="refresh"
                  onSelect={() => {
                    clearTerminal(tab.terminal.id);
                  }}
                >
                  Clear Terminal
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem icon="x" onSelect={() => closeTab(tab)}>
                  Close Tab
                </ContextMenuItem>
              </ContextMenu>
            ) : (
              trigger
            );
          })}
        </Tabs.List>
      </Tabs.Root>
      <Menu
        label="New workbench tab"
        trigger={<IconButton icon="plus" label="New workbench tab" />}
      >
        {workbenchTabs(scope).map((tab) => (
          <MenuItem
            key={tab}
            icon={tabIcons[tab]}
            onSelect={() => {
              if (tab === "terminal") {
                void terminalActions.create(viewKey, workspacePath);
              }
              workbenchController.actions.openTab(viewKey, tab);
            }}
          >
            {workbenchTabLabel(tab)}
          </MenuItem>
        ))}
      </Menu>
      <ConfirmDialog
        open={terminalClose.kind !== "closed"}
        pending={terminalClose.kind === "closing"}
        error={terminalClose.kind === "confirming" ? terminalClose.error : undefined}
        returnFocusRef={terminalCloseRef}
        title={
          terminalClose.kind === "closed"
            ? "Close terminal?"
            : `Close ${terminalClose.terminal.title}?`
        }
        description="This ends this shell session and any processes running in it."
        confirmLabel="Close terminal"
        pendingLabel="Closing…"
        onOpenChange={() => setTerminalClose({ kind: "closed" })}
        onConfirm={() => {
          if (terminalClose.kind === "confirming") void closeTerminal(terminalClose.terminal);
        }}
      />
    </div>
  );
}
