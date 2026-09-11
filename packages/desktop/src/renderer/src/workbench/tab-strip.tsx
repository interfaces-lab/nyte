import { copyTerminal, clearTerminal } from "./terminal-runtime.ts";
import { create, props } from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui";
import { Tabs } from "@nyte-ai/ui/tabs";
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
import { nyte } from "../nyte.ts";
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
import { getTerminals, isShellTerminal, terminalActions, useTerminals } from "./terminal-store.ts";
import type { TerminalTab } from "./terminal-store.ts";
import { fileActions, useFileTabs } from "./file-store.ts";
import type { FileTab } from "./file-store.ts";

const TAB_CONTENT_FADE =
  "linear-gradient(to right, black calc(100% - 36px), transparent calc(100% - 12px))";

const styles = create({
  root: { display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0 },
  tabs: { display: "flex", minWidth: 0, overflowX: "auto", scrollbarWidth: "none" },
  list: { display: "flex", alignItems: "center", gap: 1, minWidth: 0 },
  item: {
    "--_tab-close-opacity": {
      default: "0",
      ":hover": "1",
      ":focus-within": "1",
      "@media (hover: none)": "1",
    },
    "--_tab-close-pointer-events": {
      default: "none",
      ":hover": "auto",
      ":focus-within": "auto",
      "@media (hover: none)": "auto",
    },
    "--_tab-content-mask": {
      default: "none",
      ":hover": TAB_CONTENT_FADE,
      ":focus-within": TAB_CONTENT_FADE,
      "@media (hover: none)": TAB_CONTENT_FADE,
    },
    position: "relative",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    maxWidth: 200,
    height: 25,
    borderRadius: t.radiusBase,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.textTertiary,
  },
  active: { backgroundColor: t.fillGhostSelected, color: t.textPrimary },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    height: "100%",
    paddingInlineStart: 5,
    paddingInlineEnd: 6,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: "transparent",
    color: "inherit",
    fontSize: t.fontBase,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  content: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    paddingInlineEnd: 0,
    WebkitMaskImage: "var(--_tab-content-mask)",
    maskImage: "var(--_tab-content-mask)",
  },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  preview: { fontStyle: "italic" },
  tabIcon: { display: "inline-flex" },
  reactIcon: { color: t.textCyan },
  typescriptIcon: { color: t.textAccent },
  javascriptIcon: { color: t.textWarning },
  dirty: {
    width: 5,
    height: 5,
    flexShrink: 0,
    borderRadius: "50%",
    backgroundColor: t.textWarning,
  },
  close: {
    position: "absolute",
    insetInlineEnd: 4,
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: "transparent",
    color: t.iconSecondary,
    opacity: "var(--_tab-close-opacity)",
    pointerEvents: "var(--_tab-close-pointer-events)",
    cursor: "pointer",
    transitionProperty: "opacity",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
  },
});

const tabIcons = {
  files: "file",
  changes: "git-branch",
  browser: "globe",
  terminal: "console",
  agents: "robot",
} satisfies Record<WorkbenchTabId, IconName>;

const fileIcons = new Map<string, IconName>([
  ["tsx", "react"],
  ["jsx", "react"],
  ["ts", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["json", "settings"],
  ["toml", "settings"],
  ["yaml", "settings"],
  ["yml", "settings"],
]);

type StripTab =
  | { readonly kind: "panel"; readonly panel: Exclude<WorkbenchTabId, "terminal"> }
  | { readonly kind: "terminal"; readonly terminal: TerminalTab }
  | { readonly kind: "file"; readonly file: FileTab };

type TerminalCloseState =
  | { readonly kind: "closed" }
  | {
      readonly kind: "confirming";
      readonly terminal: TerminalTab;
      readonly error: string | undefined;
    }
  | { readonly kind: "closing"; readonly terminal: TerminalTab };

function tabValue(tab: StripTab): string {
  if (tab.kind === "file") return `file:${encodeURIComponent(tab.file.path)}`;
  return tab.kind === "panel" ? tab.panel : tab.terminal.id;
}

function tabLabel(tab: StripTab): string {
  if (tab.kind === "file")
    return tab.file.displayPath.split(/[\\/]/).at(-1) ?? tab.file.displayPath;
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
  const files = useFileTabs(viewKey);
  const pendingFile = files.tabs.find((file) => file.path === files.pendingClosePath);
  const stripRef = useRef<HTMLDivElement>(null);
  const terminalCloseRef = useRef<HTMLButtonElement>(null);
  const fileCloseRef = useRef<HTMLButtonElement>(null);
  const [terminalClose, setTerminalClose] = useState<TerminalCloseState>({ kind: "closed" });
  const tabs = view.openTabs.flatMap<StripTab>((tab) => {
    if (!workbenchTabAvailable(scope, tab)) return [];
    if (tab === "files" && files.tabs.length > 0) {
      return files.tabs.map((file) => ({ kind: "file", file }));
    }
    return tab === "terminal"
      ? terminals.tabs.map((terminal) => ({ kind: "terminal", terminal }))
      : [{ kind: "panel", panel: tab }];
  });
  const activePanel = activeWorkbenchTab(view, scope);
  const activeValue =
    activePanel === "terminal"
      ? terminals.activeId
      : activePanel === "files" && files.activePath !== undefined
        ? `file:${encodeURIComponent(files.activePath)}`
        : activePanel;

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
  const requestTerminalClose = async (terminal: TerminalTab): Promise<void> => {
    // A refused check keeps the confirmation; only a visibly idle prompt skips it.
    const idle =
      isShellTerminal(terminal) && terminal.state.kind === "running"
        ? await nyte.host.terminal.idle({ id: terminal.id }).catch(() => false)
        : true;
    if (idle) await closeTerminal(terminal);
    else setTerminalClose({ kind: "confirming", terminal, error: undefined });
  };
  const closeTab = (tab: StripTab): void => {
    if (tab.kind === "file") {
      if (fileActions.close(viewKey, tab.file.path)) focusSelectedTab();
      return;
    }
    if (tab.kind === "terminal") {
      void requestTerminalClose(tab.terminal);
    } else {
      workbenchController.actions.closeTab(viewKey, tab.panel);
      focusSelectedTab();
    }
  };

  return (
    <div ref={stripRef} {...props(styles.root)}>
      <Tabs.Root
        value={activeValue}
        {...props(styles.tabs)}
        onValueChange={(value) => {
          const next = tabs.find((tab) => tabValue(tab) === value);
          if (next === undefined) return;
          if (next.kind === "file") {
            fileActions.select(viewKey, next.file.path);
            return;
          }
          if (next.kind === "terminal") terminalActions.select(viewKey, next.terminal.id);
          workbenchController.actions.openTab(
            viewKey,
            next.kind === "panel" ? next.panel : "terminal",
          );
        }}
      >
        <Tabs.List aria-label="Workbench tabs" {...props(styles.list)}>
          {tabs.map((tab) => {
            const value = tabValue(tab);
            const label = tabLabel(tab);
            const panel =
              tab.kind === "panel" ? tab.panel : tab.kind === "file" ? "files" : "terminal";
            const icon =
              tab.kind === "file"
                ? (fileIcons.get(tab.file.displayPath.split(".").at(-1) ?? "") ?? "file-text")
                : tabIcons[panel];
            const trigger = (
              <div
                key={value}
                role="presentation"
                {...props(styles.item, activeValue === value && styles.active)}
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
                  title={
                    tab.kind === "terminal"
                      ? isShellTerminal(tab.terminal)
                        ? tab.terminal.cwd
                        : `${tab.terminal.title} · Agent command, read-only`
                      : tab.kind === "file"
                        ? tab.file.displayPath
                        : label
                  }
                  aria-label={
                    tab.kind === "file"
                      ? `${tab.file.displayPath}${tab.file.dirty ? ", unsaved changes" : ""}`
                      : label
                  }
                  onDoubleClick={() => {
                    if (tab.kind === "file") fileActions.pin(viewKey, tab.file.path);
                  }}
                  aria-controls={`${viewKey}-panel-${panel}`}
                  {...props(styles.tab, focus.ringInset)}
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
                  <span {...props(styles.content)}>
                    <span
                      {...props(
                        styles.tabIcon,
                        icon === "react" && styles.reactIcon,
                        icon === "typescript" && styles.typescriptIcon,
                        icon === "javascript" && styles.javascriptIcon,
                      )}
                    >
                      <Icon name={icon} size={16} />
                    </span>
                    <span
                      {...props(
                        styles.label,
                        tab.kind === "file" && tab.file.preview && styles.preview,
                      )}
                    >
                      {label}
                    </span>
                    {tab.kind === "file" && tab.file.dirty && (
                      <span aria-hidden="true" {...props(styles.dirty)} />
                    )}
                  </span>
                </Tabs.Tab>
                <Button
                  unstyled
                  type="button"
                  ref={
                    activeValue !== value
                      ? undefined
                      : tab.kind === "terminal"
                        ? terminalCloseRef
                        : tab.kind === "file"
                          ? fileCloseRef
                          : undefined
                  }
                  tabIndex={activeValue === value ? 0 : -1}
                  aria-label={`Close ${label} tab`}
                  title={`Close ${label} tab`}
                  {...props(styles.close, focus.ringInset)}
                  onClick={(event) => {
                    if (tab.kind === "terminal") terminalCloseRef.current = event.currentTarget;
                    if (tab.kind === "file") fileCloseRef.current = event.currentTarget;
                    closeTab(tab);
                  }}
                >
                  <Icon name="x" size={14} />
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
        trigger={<IconButton compact size={16} icon="plus" label="New workbench tab" />}
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
        open={pendingFile !== undefined}
        pending={pendingFile?.saving === true}
        pendingLabel="Saving…"
        error={undefined}
        returnFocusRef={fileCloseRef}
        title="Discard unsaved changes?"
        description={`Your changes to ${pendingFile?.displayPath ?? "this file"} will be lost.`}
        confirmLabel="Discard changes"
        onOpenChange={() => fileActions.cancelClose(viewKey)}
        onConfirm={() => {
          fileActions.discardClose(viewKey);
          focusSelectedTab();
        }}
      />
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
