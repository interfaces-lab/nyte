import * as stylex from "@stylexjs/stylex";
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
import { Spinner } from "../components/spinner.tsx";
import { focus, IconButton } from "../components/ui.tsx";
import { nyte } from "../nyte.ts";
import { agent, glyph } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
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
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.textTertiary,
  },
  active: { backgroundColor: t.fillGhostSelected, color: t.textPrimary },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    height: "100%",
    paddingInlineStart: 4,
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
  agentTerminal: { color: agent.accent },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  preview: { fontStyle: "italic" },
  tabIcon: { display: "inline-flex" },
  reactIcon: { color: t.textCyan },
  typescriptIcon: { color: t.textAccent },
  javascriptIcon: { color: t.textWarning },
  dirty: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: "50%",
    backgroundColor: t.textWarning,
  },
  running: {
    display: "inline-flex",
    width: glyph.box,
    height: glyph.box,
    flexShrink: 0,
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
  file: "file",
  files: "file",
  changes: "git-branch",
  browser: "globe",
  terminal: "console",
} satisfies Record<WorkbenchTabKind, IconName>;

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
  workspacePath,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly view: WorkbenchViewState;
  readonly scope: WorkbenchScope;
  readonly workspacePath: string | null;
}): ReactElement {
  const terminals = useTerminalRuntime();
  const files = useFileTabs(viewKey);
  const pendingFile = files.tabs.find((file) => file.path === files.pendingClosePath);
  const stripRef = useRef<HTMLDivElement>(null);
  const terminalCloseRef = useRef<HTMLButtonElement>(null);
  const fileCloseRef = useRef<HTMLButtonElement>(null);
  const [terminalClose, setTerminalClose] = useState<TerminalCloseState>({ kind: "closed" });
  const tabs = view.tabs.filter((tab) => workbenchTabAvailable(scope, tab.kind));
  const activeValue = activeWorkbenchTab(view, scope)?.id ?? null;

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

    const idle =
      terminal.state.kind === "running"
        ? await nyte.host.terminal.idle({ id: terminal.id }).catch(() => false)
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
        {...stylex.props(styles.tabs)}
        onValueChange={(id) => workbenchController.actions.activateTab({ view: viewKey, id })}
      >
        <Tabs.List aria-label="Workbench tabs" {...stylex.props(styles.list)}>
          {tabs.map((tab) => {
            const file =
              tab.kind === "file" ? files.tabs.find((item) => item.id === tab.id) : undefined;

            const terminal = tab.kind === "terminal" ? terminals.get(tab.id) : undefined;

            const label =
              file?.displayPath.split(/[\\/]/).at(-1) ?? terminal?.title ?? workbenchTabLabel(tab);

            const icon =
              file === undefined
                ? tabIcons[tab.kind]
                : (fileIcons.get(file.displayPath.split(".").at(-1) ?? "") ?? "file-text");

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
                    if (file !== undefined) fileActions.pin(viewKey, file.path);
                  }}
                  aria-controls={`${viewKey}-panel-${tab.kind === "file" || tab.kind === "files" ? "files" : tab.id}`}
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
                  <span
                    data-agent-terminal={agentTerminal ? "true" : undefined}
                    {...stylex.props(styles.content, agentTerminal && styles.agentTerminal)}
                  >
                    <span
                      {...stylex.props(
                        styles.tabIcon,
                        icon === "react" && styles.reactIcon,
                        icon === "typescript" && styles.typescriptIcon,
                        icon === "javascript" && styles.javascriptIcon,
                      )}
                    >
                      <Icon name={icon} size={16} />
                    </span>
                    <span {...stylex.props(styles.label, file?.preview && styles.preview)}>
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
                <Button
                  unstyled
                  type="button"
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
                  aria-label={`Close ${label} tab`}
                  title={`Close ${label} tab`}
                  {...stylex.props(styles.close, focus.ringInset)}
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

            return terminal === undefined ? (
              trigger
            ) : (
              <ContextMenu key={tab.id} label={`${label} actions`} trigger={trigger}>
                <ContextMenuItem
                  icon="console"
                  onSelect={() => newTerminal(viewKey, workspacePath)}
                >
                  New Terminal
                </ContextMenuItem>
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
        trigger={<IconButton icon="plus" label="New workbench tab" />}
      >
        {workbenchTabs(scope).map((kind) => (
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
