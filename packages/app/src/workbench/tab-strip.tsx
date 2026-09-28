import * as stylex from "@stylexjs/stylex";
import { Tabs } from "@nyte-ai/ui/tabs";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ClientCapabilities } from "../client-actions.ts";
import { errorMessage } from "../errors.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { FileTypeIcon } from "../components/file-type-icon.tsx";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "@nyte-ai/ui/context-menu";
import { Menu, MenuItem } from "@nyte-ai/ui/menu";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Button } from "@nyte-ai/ui/button";
import { nyte } from "../nyte.ts";
import { glyph } from "@nyte-ai/ui/schema.stylex";
import { t } from "@nyte-ai/ui/vars.stylex";
import {
  activeWorkbenchTab,
  defaultWorkbenchTab,
  workbenchController,
  workbenchTabAvailable,
  workbenchKindLabel,
  workbenchTabLabel,
  workbenchTabs,
} from "./controller.ts";
import type {
  WorkbenchScope,
  WorkbenchTab,
  WorkbenchTabKind,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "./controller.ts";
import { copyTerminal, clearTerminal } from "./terminal-runtime.ts";
import { isJobTerminal, terminalActions, useTerminalRuntime } from "./terminal-store.ts";
import type { TerminalTab } from "./terminal-store.ts";
import { fileActions, useFileTabs } from "./file-store.ts";

const TAB_CONTENT_FADE =
  "linear-gradient(to right, black calc(100% - 36px), transparent calc(100% - 12px))";

const styles = stylex.create({
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
    height: 26,
    borderRadius: t.radiusBase,
    backgroundColor: { default: "transparent", ":hover": t.fillHover },
    color: t.textTertiary,
  },
  active: { backgroundColor: t.fillSelected, color: t.textPrimary },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
    height: "100%",
    paddingInlineStart: 4,
    paddingInlineEnd: 6,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: "transparent",
    color: "inherit",
    fontSize: t.fontBase,
    cursor: t.cursorInteractive,
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
  agentTerminal: { color: t.purple },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  preview: { fontStyle: "italic" },
  tabIcon: { display: "inline-flex" },
  dirty: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: "50%",
    backgroundColor: t.yellow,
  },
  running: {
    display: "inline-flex",
    width: glyph.box,
    height: glyph.box,
    flexShrink: 0,
  },
  // The tab reveals its close button; the button itself stays stock.
  close: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: 4,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    opacity: "var(--_tab-close-opacity)",
    pointerEvents: "var(--_tab-close-pointer-events)",
    transitionProperty: "opacity",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
  },
});

const tabIcons = {
  file: "file",
  files: "file",
  changes: "git-branch",
  browser: "globe",
  terminal: "console",
} satisfies Record<WorkbenchTabKind, IconName>;

type TerminalCloseState =
  | { readonly kind: "closed" }
  | {
      readonly kind: "confirming";
      readonly tab: WorkbenchTab;
      readonly terminal: TerminalTab;
      readonly error: string | undefined;
    }
  | { readonly kind: "closing"; readonly tab: WorkbenchTab; readonly terminal: TerminalTab };

function newTerminal(view: WorkbenchViewKey, workspacePath: string | null): void {
  if (nyte.host.terminal === undefined) return;
  const id = workbenchController.actions.openTab({
    view,
    tab: { kind: "terminal", owner: { kind: "user" } },
    activate: true,
  });

  void terminalActions.create({ id, workspacePath });
}

export function WorkbenchTabStrip({
  viewKey,
  view,
  scope,
  capabilities,
  workspacePath,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly view: WorkbenchViewState;
  readonly scope: WorkbenchScope;
  readonly capabilities: ClientCapabilities;
  readonly workspacePath: string | null;
}): ReactElement {
  const terminals = useTerminalRuntime();
  const files = useFileTabs(viewKey);
  const pendingFile = files.pendingClose;
  const stripRef = useRef<HTMLDivElement>(null);
  const terminalCloseRef = useRef<HTMLButtonElement>(null);
  const fileCloseRef = useRef<HTMLButtonElement>(null);
  const [terminalClose, setTerminalClose] = useState<TerminalCloseState>({ kind: "closed" });
  const tabs = view.tabs.filter((tab) => workbenchTabAvailable(scope, tab.kind, capabilities));
  const activeValue = activeWorkbenchTab(view, scope, capabilities)?.id ?? null;

  const focusSelectedTab = (): void => {
    requestAnimationFrame(() => {
      const selected = stripRef.current?.querySelector('[role="tab"][aria-selected="true"]');

      if (selected instanceof HTMLElement) selected.focus();
      else document.getElementById("workbench-toggle")?.focus();
    });
  };

  const closeTerminal = async (tab: WorkbenchTab, terminal: TerminalTab): Promise<void> => {
    setTerminalClose({ kind: "closing", tab, terminal });

    try {
      await terminalActions.close(terminal.id);
      workbenchController.actions.closeTab({ view: viewKey, id: tab.id });
      setTerminalClose({ kind: "closed" });
      focusSelectedTab();
    } catch (cause: unknown) {
      setTerminalClose({ kind: "confirming", tab, terminal, error: errorMessage(cause) });
    }
  };

  const requestTerminalClose = async (tab: WorkbenchTab, terminal: TerminalTab): Promise<void> => {
    if (isJobTerminal(terminal)) {
      await closeTerminal(tab, terminal);

      return;
    }

    const terminalBridge = nyte.host.terminal;

    if (terminalBridge === undefined) return;

    const idle =
      terminal.state.kind === "running"
        ? await terminalBridge.idle({ id: terminal.id }).catch(() => false)
        : true;

    if (idle) await closeTerminal(tab, terminal);
    else setTerminalClose({ kind: "confirming", tab, terminal, error: undefined });
  };

  const closeTab = (tab: WorkbenchTab): void => {
    if (tab.kind === "file") {
      if (fileActions.close(viewKey, tab.path)) focusSelectedTab();

      return;
    }

    if (tab.kind === "terminal") {
      const terminal = terminals.get(tab.id);

      if (terminal === undefined) {
        workbenchController.actions.closeTab({ view: viewKey, id: tab.id });
        focusSelectedTab();
      } else {
        void requestTerminalClose(tab, terminal);
      }

      return;
    }

    workbenchController.actions.closeTab({ view: viewKey, id: tab.id });
    focusSelectedTab();
  };

  return (
    <div ref={stripRef} {...stylex.props(styles.root)}>
      <Tabs.Root
        value={activeValue}
        xstyle={styles.tabs}
        onValueChange={(id) => workbenchController.actions.activateTab({ view: viewKey, id })}
      >
        <Tabs.List aria-label="Workbench tabs" xstyle={styles.list}>
          {tabs.map((tab) => {
            const file =
              tab.kind === "file" ? files.tabs.find((item) => item.id === tab.id) : undefined;

            const terminal = tab.kind === "terminal" ? terminals.get(tab.id) : undefined;
            const label = terminal?.title ?? workbenchTabLabel(tab);

            const agentTerminal = terminal !== undefined && isJobTerminal(terminal);
            const running = agentTerminal && terminal.state.kind === "running";

            const trigger = (
              <div
                key={tab.id}
                role="presentation"
                {...stylex.props(styles.item, activeValue === tab.id && styles.active)}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    closeTab(tab);
                  }
                }}
              >
                <Tabs.Tab
                  id={`${viewKey}-tab-${tab.id}`}
                  value={tab.id}
                  title={
                    agentTerminal
                      ? `${terminal.title} · Agent command · read-only`
                      : (terminal?.cwd ?? file?.displayPath ?? label)
                  }
                  aria-label={
                    file === undefined
                      ? label
                      : `${file.displayPath}${file.dirty ? ", unsaved changes" : ""}`
                  }
                  onDoubleClick={() => {
                    if (tab.kind === "file") fileActions.pin(viewKey, tab.path);
                  }}
                  aria-controls={`${viewKey}-panel-${tab.kind === "file" || tab.kind === "files" ? "files" : tab.id}`}
                  xstyle={styles.tab}
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
                  <span
                    data-agent-terminal={agentTerminal ? "true" : undefined}
                    {...stylex.props(styles.content, agentTerminal && styles.agentTerminal)}
                  >
                    {tab.kind === "file" ? (
                      <FileTypeIcon path={tab.path} />
                    ) : (
                      <span {...stylex.props(styles.tabIcon)}>
                        <Icon name={tabIcons[tab.kind]} size={16} />
                      </span>
                    )}
                    <span
                      {...stylex.props(
                        styles.label,
                        tab.kind === "file" && tab.preview && styles.preview,
                      )}
                    >
                      {label}
                    </span>
                    {file?.dirty && <span aria-hidden="true" {...stylex.props(styles.dirty)} />}
                    {running && (
                      <span aria-label="Running" {...stylex.props(styles.running)}>
                        <Spinner />
                      </span>
                    )}
                  </span>
                </Tabs.Tab>
                <span {...stylex.props(styles.close)}>
                  <Button
                    size="icon-xs"
                    icon="x"
                    aria-label={`Close ${label} tab`}
                    ref={
                      activeValue !== tab.id
                        ? undefined
                        : tab.kind === "terminal"
                          ? terminalCloseRef
                          : tab.kind === "file"
                            ? fileCloseRef
                            : undefined
                    }
                    tabIndex={activeValue === tab.id ? 0 : -1}
                    onClick={(event) => {
                      if (tab.kind === "terminal") terminalCloseRef.current = event.currentTarget;

                      if (tab.kind === "file") fileCloseRef.current = event.currentTarget;
                      closeTab(tab);
                    }}
                  />
                </span>
              </div>
            );

            return terminal === undefined ? (
              trigger
            ) : (
              <ContextMenu key={tab.id} label={`${label} actions`} trigger={trigger}>
                {capabilities.terminal && (
                  <ContextMenuItem
                    icon="console"
                    onSelect={() => newTerminal(viewKey, workspacePath)}
                  >
                    New Terminal
                  </ContextMenuItem>
                )}
                <ContextMenuItem icon="copy" onSelect={() => copyTerminal(terminal.id)}>
                  Copy Selection
                </ContextMenuItem>
                <ContextMenuItem icon="refresh" onSelect={() => clearTerminal(terminal.id)}>
                  Clear Terminal
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem icon="x" onSelect={() => closeTab(tab)}>
                  Close Tab
                </ContextMenuItem>
              </ContextMenu>
            );
          })}
        </Tabs.List>
      </Tabs.Root>
      <Menu
        label="New workbench tab"
        trigger={<Button size="icon" icon="plus" aria-label="New workbench tab" />}
      >
        {workbenchTabs(scope, capabilities).map((kind) => (
          <MenuItem
            key={kind}
            icon={tabIcons[kind]}
            onSelect={() => {
              if (kind === "terminal") {
                newTerminal(viewKey, workspacePath);

                return;
              }

              workbenchController.actions.openTab({
                view: viewKey,
                tab: defaultWorkbenchTab(kind),
                activate: true,
              });
            }}
          >
            {workbenchKindLabel(kind)}
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
          if (terminalClose.kind === "confirming") {
            void closeTerminal(terminalClose.tab, terminalClose.terminal);
          }
        }}
      />
    </div>
  );
}
