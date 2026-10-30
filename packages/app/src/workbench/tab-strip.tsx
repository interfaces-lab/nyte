import { create, props } from "@stylexjs/stylex";
import { Tabs } from "@nyte-ai/ui/tabs";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import { errorMessage } from "../contract/errors.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { FileTypeIcon } from "../components/file-type-icon.tsx";
import { SortableItem, SortableList } from "../components/sortable-strip.tsx";
import { Icon } from "@nyte-ai/ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@nyte-ai/ui/context-menu";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Loader } from "@nyte-ai/ui/loader";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Button } from "@nyte-ai/ui/button";
import { chatTitle, useChat } from "../chats/index.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { control, glyph, media, radius, space, target } from "@nyte-ai/ui/styles/schema.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { appearance, motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import {
  tabSlot,
  WORKBENCH_CHAT_TAB,
  WORKBENCH_KINDS,
  workbenchLaunchers,
  workbenchShowsChat,
} from "./model.ts";
import type {
  WorkbenchScope,
  WorkbenchTab,
  WorkbenchTabId,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "./model.ts";
import { activeWorkbenchTab, tabPresentation, visibleTabs } from "./selectors.ts";
import { workbench } from "./store.ts";
import { closeTab, endTerminal, launch } from "./commands.ts";
import { readDeferred } from "../lib/deferred.tsx";
import { useCanvasEditing } from "../canvas/canvas-activity.ts";
import { useTerminalRuntime } from "./terminal/terminal-store.ts";
import { fileActions, useFileTabs } from "./files/file-store.ts";

const TAB_CONTENT_FADE =
  "linear-gradient(to right, black calc(100% - 36px), transparent calc(100% - 12px))";

const styles = create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: space.px,
    flex: 1,
    minWidth: 0,
    WebkitAppRegion: "drag",
  },
  control: { WebkitAppRegion: "no-drag" },
  tabs: { display: "flex", minWidth: 0, overflowX: "auto", scrollbarWidth: "none" },
  list: { display: "flex", alignItems: "center", gap: space.px, minWidth: 0 },
  slot: { display: "flex", flexShrink: 0 },
  item: {
    "--_tab-close-opacity": {
      default: "0",
      ":hover": { [media.hover]: "1" },
      ":has(:focus-visible)": "1",
      "@media (hover: none)": "1",
    },
    "--_tab-close-pointer-events": {
      default: "none",
      ":hover": { [media.hover]: "auto" },
      ":has(:focus-visible)": "auto",
      "@media (hover: none)": "auto",
    },
    "--_tab-content-mask": {
      default: "none",
      ":hover": { [media.hover]: TAB_CONTENT_FADE },
      ":has(:focus-visible)": TAB_CONTENT_FADE,
      "@media (hover: none)": TAB_CONTENT_FADE,
    },
    position: "relative",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    maxWidth: 200,
    height: control.heightSm,
    minHeight: target.min,
    WebkitAppRegion: "no-drag",
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": { [media.hover]: role.bgHover },
    },
    color: role.contentInteractiveSecondary,
  },
  active: { backgroundColor: role.bgInteractiveSecondaryTranslucent, color: role.contentPrimary },
  chatItem: { "--_tab-content-mask": "none" },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 1,
    minWidth: 0,
    height: "100%",
    paddingBlock: space.s0_5,
    paddingInlineStart: space.s1,
    paddingInlineEnd: space.s1_5,
    borderRadius: radius.control,
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
    cursor: appearance.cursorInteractive,
    whiteSpace: "nowrap",
  },
  content: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
    minWidth: 0,
    WebkitMaskImage: "var(--_tab-content-mask)",
    maskImage: "var(--_tab-content-mask)",
  },
  agentTerminal: {
    color: {
      default: role.contentSecondary,
      ":hover": { [media.hover]: role.contentPrimary },
      ":focus-within": role.contentPrimary,
    },
  },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  preview: { fontStyle: "italic" },
  tabIcon: { display: "inline-flex" },
  dirty: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: "50%",
    backgroundColor: role.contentAccent,
  },
  running: {
    display: "inline-flex",
    width: glyph.md,
    height: glyph.md,
    flexShrink: 0,
  },
  close: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: space.s1,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    opacity: "var(--_tab-close-opacity)",
    pointerEvents: "var(--_tab-close-pointer-events)",
    transitionProperty: "opacity",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
  },
});

type TerminalCloseState =
  | { readonly kind: "closed" }
  | {
      readonly kind: "confirming";
      readonly id: WorkbenchTabId;
      readonly error: string | undefined;
    }
  | { readonly kind: "closing"; readonly id: WorkbenchTabId };

/** A canvas tab's icon and title, tinted with a spinner while the agent rewrites the canvas. */
function CanvasTabContent({
  tab,
}: {
  readonly tab: Extract<WorkbenchTab, { readonly kind: "canvas" }>;
}): ReactElement {
  const editing = useCanvasEditing(tab.sessionId, tab.part);

  return (
    <span
      {...props(editing && surfaceTheme.purple, styles.content, editing && styles.agentTerminal)}
    >
      <span {...props(styles.tabIcon)}>
        <Icon name={WORKBENCH_KINDS.canvas.icon} size="md" />
      </span>
      <span {...props(styles.label)}>{tab.title}</span>
      {editing && (
        <span aria-label="Updating" {...props(styles.running)}>
          <Spinner />
        </span>
      )}
    </span>
  );
}

function ChatTabLabel({ sessionId }: { readonly sessionId: SessionId }): ReactElement {
  const chat = useChat(sessionId);

  return <>{chatTitle(chat.kind === "ready" ? chat.chat : undefined)}</>;
}

export function WorkbenchTabStrip({
  viewKey,
  view,
  scope,
  capabilities,
  sessionId,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly view: WorkbenchViewState;
  readonly scope: WorkbenchScope;
  readonly capabilities: ClientCapabilities;
  readonly sessionId?: SessionId;
}): ReactElement {
  const terminals = useTerminalRuntime();
  const files = useFileTabs(viewKey);
  const pendingFile = files.pendingClose;
  const stripRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const terminalCloseRef = useRef<HTMLButtonElement>(null);
  const fileCloseRef = useRef<HTMLButtonElement>(null);
  const [terminalClose, setTerminalClose] = useState<TerminalCloseState>({ kind: "closed" });
  const tabs = visibleTabs(view, scope, capabilities);
  const chatShowing = workbenchShowsChat(view.layout);

  const activeValue = chatShowing
    ? WORKBENCH_CHAT_TAB
    : (activeWorkbenchTab(view, scope, capabilities)?.id ?? null);

  const focusSelectedTab = (): void => {
    requestAnimationFrame(() => {
      const selected = stripRef.current?.querySelector('[role="tab"][aria-selected="true"]');

      if (selected instanceof HTMLElement) selected.focus();
      else document.getElementById("workbench-toggle")?.focus();
    });
  };

  const endShell = (id: WorkbenchTabId): void => {
    setTerminalClose({ kind: "closing", id });
    void endTerminal(viewKey, id).then(
      () => {
        setTerminalClose({ kind: "closed" });
        focusSelectedTab();
      },
      (cause: unknown) => setTerminalClose({ kind: "confirming", id, error: errorMessage(cause) }),
    );
  };

  const close = (tab: WorkbenchTab): void => {
    void closeTab(viewKey, tab.id).then(
      (outcome) => {
        if (outcome.kind === "closed") focusSelectedTab();
        else if (outcome.reason === "running")
          setTerminalClose({ kind: "confirming", id: tab.id, error: undefined });
      },
      (cause: unknown) =>
        setTerminalClose({ kind: "confirming", id: tab.id, error: errorMessage(cause) }),
    );
  };

  return (
    <div ref={stripRef} {...props(styles.root)}>
      <Tabs.Root
        ref={listRef}
        value={activeValue}
        xstyle={styles.tabs}
        onValueChange={(id) =>
          id === WORKBENCH_CHAT_TAB
            ? workbench.dispatch(viewKey, { kind: "show-chat" })
            : workbench.dispatch(viewKey, { kind: "activate", id })
        }
      >
        <Tabs.List aria-label="Workbench tabs" xstyle={styles.list}>
          {view.layout.kind === "maximized" && (
            <div
              role="presentation"
              {...props(styles.item, styles.chatItem, chatShowing && styles.active)}
            >
              <Tabs.Tab
                variant="bare"
                id={`${viewKey}-tab-${WORKBENCH_CHAT_TAB}`}
                value={WORKBENCH_CHAT_TAB}
                aria-controls={`${viewKey}-panel-${WORKBENCH_CHAT_TAB}`}
                xstyle={styles.tab}
                onFocus={(event) =>
                  event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })
                }
              >
                <span {...props(styles.content)}>
                  <span {...props(styles.tabIcon)}>
                    <Icon name="imac" size="md" />
                  </span>
                  <span {...props(styles.label)}>
                    {sessionId === undefined ? "New chat" : <ChatTabLabel sessionId={sessionId} />}
                  </span>
                </span>
              </Tabs.Tab>
            </div>
          )}
          <SortableList
            ids={tabs.map((tab) => tab.id)}
            listRef={listRef}
            onPick={(id) => workbench.dispatch(viewKey, { kind: "activate", id })}
            onReorder={(order, id) => {
              const after = order[order.findIndex((entry) => entry === id) + 1];

              workbench.dispatch(viewKey, {
                kind: "move",
                id,
                index:
                  after === undefined
                    ? view.tabs.length
                    : view.tabs.filter((tab) => tab.id !== id).findIndex((tab) => tab.id === after),
              });
            }}
          >
            {tabs.map((tab) => {
              const file =
                tab.kind === "file" ? files.tabs.find((item) => item.id === tab.id) : undefined;

              const terminal = tab.kind === "terminal" ? terminals.get(tab.id) : undefined;
              const presentation = tabPresentation(tab, file, terminal);
              const label = presentation.label;

              const agentTerminal = terminal !== undefined && terminal.kind === "job";
              const running = agentTerminal && terminal.state.kind === "running";

              const trigger = (
                <div
                  role="presentation"
                  {...props(
                    agentTerminal && surfaceTheme.purple,
                    styles.item,
                    agentTerminal && styles.agentTerminal,
                    activeValue === tab.id && styles.active,
                  )}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      close(tab);
                    }
                  }}
                >
                  <Tabs.Tab
                    variant="bare"
                    id={`${viewKey}-tab-${tab.id}`}
                    value={tab.id}
                    title={
                      agentTerminal
                        ? `${terminal.title} · Agent command · read-only`
                        : (presentation.title ?? label)
                    }
                    aria-label={
                      file === undefined
                        ? label
                        : `${file.displayPath}${file.dirty ? ", unsaved changes" : ""}`
                    }
                    onDoubleClick={() => {
                      if (tab.kind === "file") fileActions.pin(viewKey, tab.path);
                    }}
                    aria-controls={`${viewKey}-panel-${tabSlot(tab)}`}
                    xstyle={styles.tab}
                    onFocus={(event) =>
                      event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Delete") {
                        event.preventDefault();
                        close(tab);
                      }
                    }}
                  >
                    {tab.kind === "canvas" ? (
                      <CanvasTabContent tab={tab} />
                    ) : (
                      <span
                        data-agent-terminal={agentTerminal ? "true" : undefined}
                        {...props(styles.content)}
                      >
                        {tab.kind === "file" ? (
                          <FileTypeIcon path={tab.path} />
                        ) : (
                          <span {...props(styles.tabIcon)}>
                            <Icon name={WORKBENCH_KINDS[tab.kind].icon} size="md" />
                          </span>
                        )}
                        <span
                          {...props(
                            styles.label,
                            tab.kind === "file" && tab.preview && styles.preview,
                          )}
                        >
                          {label}
                        </span>
                        {file?.dirty && (
                          <span aria-hidden="true" {...props(surfaceTheme.yellow, styles.dirty)} />
                        )}
                        {running && (
                          <span aria-label="Running" {...props(styles.running)}>
                            <Loader />
                          </span>
                        )}
                      </span>
                    )}
                  </Tabs.Tab>
                  <span {...props(styles.close)}>
                    <Button
                      size="2xs"
                      variant="plain"
                      iconOnly
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
                        close(tab);
                      }}
                    />
                  </span>
                </div>
              );

              return (
                <SortableItem key={tab.id} id={tab.id} xstyle={styles.slot}>
                  {terminal === undefined ? (
                    trigger
                  ) : (
                    <ContextMenu>
                      <ContextMenuTrigger render={trigger} />
                      <ContextMenuContent aria-label={`${label} actions`}>
                        <ContextMenuItem icon="console" onClick={() => launch(viewKey, "terminal")}>
                          New Terminal
                        </ContextMenuItem>
                        {terminal.kind === "job" && terminal.session !== null && (
                          <ContextMenuItem
                            icon="arrow-left"
                            onClick={() => {
                              if (terminal.session !== null)
                                windowTabs.openChat(terminal.session, "permanent");
                            }}
                          >
                            Open Chat
                          </ContextMenuItem>
                        )}
                        <ContextMenuItem
                          icon="copy"
                          onClick={() => readDeferred("workbench")?.copyTerminal(terminal.id)}
                        >
                          Copy Selection
                        </ContextMenuItem>
                        <ContextMenuItem
                          icon="paperclip"
                          onClick={() => readDeferred("workbench")?.addTerminalToChat(terminal.id)}
                        >
                          Add Selection to Chat
                        </ContextMenuItem>
                        <ContextMenuItem
                          icon="refresh"
                          onClick={() => readDeferred("workbench")?.clearTerminal(terminal.id)}
                        >
                          Clear Terminal
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem icon="x" onClick={() => close(tab)}>
                          Close Tab
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  )}
                </SortableItem>
              );
            })}
          </SortableList>
        </Tabs.List>
      </Tabs.Root>
      <span {...props(styles.control)}>
        <Menu>
          <MenuTrigger render={<Button iconOnly icon="plus" aria-label="New workbench tab" />} />
          <MenuContent>
            {workbenchLaunchers(scope, capabilities).map((kind) => (
              <MenuItem
                key={kind}
                icon={WORKBENCH_KINDS[kind].icon}
                onClick={() => launch(viewKey, kind)}
              >
                {WORKBENCH_KINDS[kind].label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </span>
      <ConfirmDialog
        open={pendingFile !== undefined}
        pending={pendingFile?.saving === true}
        pendingLabel="Saving…"
        error={undefined}
        finalFocus={fileCloseRef}
        title="Discard Changes"
        description={`Your changes to ${pendingFile?.displayPath ?? "this file"} will be lost.`}
        confirmLabel="Discard Changes"
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
        finalFocus={terminalCloseRef}
        title="Close Terminal"
        description="This ends this shell session and any processes running in it."
        confirmLabel="Close Terminal"
        pendingLabel="Closing…"
        onOpenChange={() => setTerminalClose({ kind: "closed" })}
        onConfirm={() => {
          if (terminalClose.kind === "confirming") endShell(terminalClose.id);
        }}
      />
    </div>
  );
}
