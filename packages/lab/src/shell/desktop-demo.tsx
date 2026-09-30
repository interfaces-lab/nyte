import { create, props } from "@stylexjs/stylex";
import { Row } from "@nyte-ai/ui/row";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { titlebarStyles } from "@nyte-ai/app/chrome/titlebar.stylex.ts";
import { threadStyles } from "@nyte-ai/app/screens/thread.stylex.ts";
import { composerStyles } from "@nyte-ai/app/conversation/styles.stylex.ts";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { Hint } from "@nyte-ai/ui/tooltip";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Toggle } from "@nyte-ai/ui/toggle";
import { t } from "@nyte-ai/ui/vars.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { TurnView } from "@nyte-ai/app/conversation/turn-view.tsx";
import { NO_WAITS } from "@nyte-ai/app/conversation/transcript-presentation.ts";
import {
  activeStickyCandidate,
  isBottomPinned,
} from "@nyte-ai/app/conversation/transcript-scroll.ts";
import type { StickyCandidate } from "@nyte-ai/app/conversation/transcript-scroll.ts";
import { SubagentTray } from "@nyte-ai/app/conversation/tray/agents.tsx";
import type { SubagentTrayView } from "@nyte-ai/app/conversation/tray/agents.tsx";
import { Workbench } from "@nyte-ai/app/workbench/workbench.tsx";
import { WorkbenchTabStrip } from "@nyte-ai/app/workbench/tab-strip.tsx";
import {
  activeWorkbenchTab,
  defaultWorkbenchTab,
  useWorkbenchSnapshot,
  workbenchController,
  workbenchViewKey,
} from "@nyte-ai/app/workbench/controller.ts";
import type { WorkbenchViewState } from "@nyte-ai/app/workbench/controller.ts";
import { clientActionShortcut, clientActions } from "@nyte-ai/app/client-actions.ts";
import {
  PaneMenu,
  SessionContext,
  DemoPopover,
  DemoDialog,
  DemoModelPicker,
} from "./demo-surfaces";
import { parentSessionId, subagents, turns } from "./fixtures";
import { workspace } from "./host-stub";
import type { AuditSurface, WorkbenchState } from "./audit-state";
import { GridOverlay } from "./grid-overlay";
import type { GridMetrics } from "./grid-overlay";

const fixture = create({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: t.sidebarMaterial,
    color: t.contentPrimary,
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    fontWeight: 400,
    WebkitFontSmoothing: "antialiased",
  },
  lights: { position: "absolute", left: 11, top: 10, display: "flex", gap: 8 },
  light: { width: 14, height: 14, borderRadius: "50%", boxShadow: "inset 0 0 0 1px #ffffff26" },
  red: { backgroundColor: "#ff5f57" },
  yellow: { backgroundColor: "#febc2e" },
  green: { backgroundColor: "#28c840" },
  main: { backgroundColor: t.bgBase },
  transcript: { paddingBlockStart: 16, paddingBlockEnd: 8 },
  flowRow: { position: "relative" },
  sidebarSeat: {
    display: "flex",
    flexShrink: 0,
    minHeight: 0,
    width: "calc(var(--nyte-sidebar-width) * var(--lab-sidebar-reveal, 1))",
    overflow: "hidden",
    transitionProperty: "width",
    transitionDuration: {
      default: "var(--lab-sidebar-duration, var(--nyte-duration-normal))",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: "var(--lab-sidebar-easing, var(--nyte-easing-out-quint))",
  },
  sidebarSlide: {
    minWidth: "var(--nyte-sidebar-width)",
    transform: "translateX(calc((var(--lab-sidebar-reveal, 1) - 1) * var(--nyte-sidebar-width)))",
    transitionProperty: "transform",
    transitionDuration: {
      default: "var(--lab-sidebar-duration, var(--nyte-duration-normal))",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: "var(--lab-sidebar-easing, var(--nyte-easing-out-quint))",
  },
  titleSlide: {
    insetInlineStart:
      "calc(112px + (var(--nyte-sidebar-width) - 100px) * var(--lab-sidebar-reveal, 1))",
    transitionProperty: "inset-inline-start",
    transitionDuration: {
      default: "var(--lab-sidebar-duration, var(--nyte-duration-normal))",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: "var(--lab-sidebar-easing, var(--nyte-easing-out-quint))",
  },
  fillSlide: {
    insetInlineStart: "calc((var(--nyte-sidebar-width) - 1px) * var(--lab-sidebar-reveal, 1))",
    transitionProperty: "inset-inline-start",
    transitionDuration: {
      default: "var(--lab-sidebar-duration, var(--nyte-duration-normal))",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: "var(--lab-sidebar-easing, var(--nyte-easing-out-quint))",
  },
  historySlide: {
    opacity: "var(--lab-sidebar-reveal, 1)",
    transform: "translateX(calc((var(--lab-sidebar-reveal, 1) - 1) * var(--nyte-sidebar-width)))",
    transitionProperty: "transform, opacity",
    transitionDuration: {
      default: "var(--lab-sidebar-duration, var(--nyte-duration-normal))",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: "var(--lab-sidebar-easing, var(--nyte-easing-out-quint))",
  },
  sidebar: {
    position: "relative",
    "::after": {
      content: "''",
      position: "absolute",
      insetBlock: 0,
      insetInlineEnd: 0,
      width: 1,
      backgroundColor: t.borderSecondaryTranslucent,
      pointerEvents: "none",
    },
  },
  activity: { color: t.intentPrimaryContent },
});

const workbenchScope = { kind: "project" } as const;

const workbenchView = workbenchViewKey(workspace.path);

const noLiveTools = new Map<string, never>();

function workbenchStateOf(view: WorkbenchViewState): WorkbenchState {
  if (view.expanded && activeWorkbenchTab(view, workbenchScope) !== null) return "panel";

  return view.collapsed === "compact" ? "compact" : "rail";
}

function applyWorkbenchState(state: WorkbenchState) {
  const { actions } = workbenchController;
  const view = workbenchController.getView(workbenchView);

  if (workbenchStateOf(view) === state) return;

  if (state === "panel") {
    const changes = view.tabs.find((tab) => tab.kind === "changes");

    if (changes === undefined)
      actions.openTab({ view: workbenchView, tab: defaultWorkbenchTab("changes"), activate: true });
    else actions.activateTab({ view: workbenchView, id: changes.id });

    return;
  }

  if (view.expanded) actions.toggle({ view: workbenchView });

  if (
    (workbenchController.getView(workbenchView).collapsed === "compact") !==
    (state === "compact")
  )
    actions.toggleCollapsed({ view: workbenchView });
}

function setDataState(element: HTMLElement, name: string, active: boolean) {
  const value = active ? "true" : "false";

  if (element.dataset[name] !== value) element.dataset[name] = value;
}

/*
 * The desktop's sticky prompt sync, measured from rects: the fixture lays its
 * turns out in flow instead of through the virtualizer the thread reads.
 */
function syncStickyUserMessage(scroll: HTMLElement) {
  const rows = scroll.querySelectorAll<HTMLElement>("[data-sticky-user-message]");
  const top = scroll.getBoundingClientRect().top - scroll.scrollTop;
  const candidates: StickyCandidate[] = [];
  const candidateRows: HTMLElement[] = [];

  for (const row of rows) {
    const turn = row.closest<HTMLElement>("[data-sticky-turn='true']");
    const wrapper = row.closest<HTMLElement>("[data-lab-turn]");
    const eligible = turn !== null && wrapper !== null && row.offsetHeight < scroll.clientHeight;
    setDataState(row, "stickyDisabled", !eligible);

    if (!eligible || turn === null || wrapper === null) continue;
    candidates.push({
      start: turn.getBoundingClientRect().top - top,
      height: wrapper.offsetHeight,
    });
    candidateRows.push(row);
  }

  const active = activeStickyCandidate(candidates, scroll.scrollTop, isBottomPinned(scroll));
  const activeRow = active === undefined ? undefined : candidateRows[active];

  for (const row of rows) setDataState(row, "stickyActive", row === activeRow);
  setDataState(scroll, "topFade", scroll.scrollTop > 0 && activeRow === undefined);
}

const sessionTitles = [
  "Audit Fable desktop layout",
  "Core architecture review",
  "Desktop fixture with token-only switching",
  "Composer paste detection",
  "Fix subagent tray",
  "Warning plugin behavior",
  "Adversarial clean-copy audit",
] as const;

export function DesktopDemo({
  sidebarVisible,
  onSidebar,
  surface,
  onSurface,
  workbench,
  onWorkbench,
  grid,
}: {
  sidebarVisible: boolean;
  onSidebar: () => void;
  surface: AuditSurface;
  onSurface: (surface: AuditSurface) => void;
  workbench: WorkbenchState;
  onWorkbench: (state: WorkbenchState) => void;
  grid: GridMetrics;
}) {
  const [sessions, setSessions] = useState<readonly string[]>(sessionTitles);
  const [selected, setSelected] = useState<string>(sessionTitles[2]);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const menuRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const togglePin = (title: string) =>
    setPinned((current) => {
      const next = new Set(current);

      if (next.has(title)) next.delete(title);
      else next.add(title);

      return next;
    });

  const archive = (title: string) => {
    const remaining = sessions.filter((item) => item !== title);
    setSessions(remaining);

    if (selected === title) setSelected(remaining[0] ?? "New chat");
  };

  const [reply, setReply] = useState("");
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const [trayView, setTrayView] = useState<SubagentTrayView>({ kind: "closed" });
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null);
  const workbenchSnapshot = useWorkbenchSnapshot();

  const view =
    workbenchSnapshot.views.get(workbenchView) ?? workbenchController.getView(workbenchView);

  const workbenchOpen = workbenchStateOf(view) === "panel";

  useLayoutEffect(() => applyWorkbenchState(workbench), [workbench]);

  useEffect(
    () =>
      workbenchController.subscribe(() => {
        const next = workbenchStateOf(workbenchController.getView(workbenchView));

        if (document.documentElement.dataset.labWorkbench !== next) onWorkbench(next);
      }),
    [onWorkbench],
  );

  useLayoutEffect(() => {
    if (scroll === null) return undefined;
    let pinned = true;

    const follow = () => {
      if (pinned) scroll.scrollTo({ top: scroll.scrollHeight });
      syncStickyUserMessage(scroll);
    };

    const track = () => {
      pinned = isBottomPinned(scroll);
      syncStickyUserMessage(scroll);
    };

    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(scroll);

    for (const child of scroll.children) observer.observe(child);
    scroll.addEventListener("scroll", track, { passive: true });

    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", track);
    };
  }, [scroll]);

  return (
    <div id="lab-shell" data-desktop-demo="" {...props(fixture.root)}>
      <header data-grid-row="titlebar" {...props(titlebarStyles.bar, titlebarStyles.barMac)}>
        <div
          {...props(
            titlebarStyles.contentFill,
            !sidebarVisible && titlebarStyles.contentFillSidebarHidden,
            fixture.fillSlide,
          )}
        />
        <span aria-hidden="true" {...props(fixture.lights)}>
          <i {...props(fixture.light, fixture.red)} />
          <i {...props(fixture.light, fixture.yellow)} />
          <i {...props(fixture.light, fixture.green)} />
        </span>
        <span {...props(titlebarStyles.actionTrack)}>
          <Button iconOnly aria-label="Toggle sidebar" onClick={onSidebar}>
            <PanelToggleIcon side="left" visible={sidebarVisible} />
          </Button>
        </span>
        <span
          inert={!sidebarVisible}
          {...props(titlebarStyles.navigationTrack, fixture.historySlide)}
        >
          <Button iconOnly icon="arrow-left" aria-label="Back" />
          <Button iconOnly icon="arrow-right" aria-label="Forward" disabled />
        </span>
        <span
          {...props(
            titlebarStyles.titleSlot,
            workbenchOpen && titlebarStyles.titleSlotWorkbenchOpen,
            !sidebarVisible && titlebarStyles.titleSlotSidebarHiddenMac,
            fixture.titleSlide,
          )}
        >
          <span {...props(titlebarStyles.sessionTitleGroup)}>
            <span {...props(titlebarStyles.sessionTitle)}>{selected}</span>
          </span>
        </span>
        <span {...props(titlebarStyles.spacer)} />
        {!(workbenchOpen && view.maximized) && (
          <span {...props(titlebarStyles.actionTrack)}>
            <PaneMenu
              surface={surface}
              onSurface={onSurface}
              trigger={<Button iconOnly ref={menuRef} icon="more" aria-label="Pane actions" />}
            />
          </span>
        )}
        {workbenchOpen && (
          <span aria-hidden="true" {...props(titlebarStyles.workbenchReservation)} />
        )}
        <div
          {...props(
            workbenchOpen ? titlebarStyles.workbenchTrack : titlebarStyles.actionTrack,
            workbenchOpen && !sidebarVisible && titlebarStyles.workbenchTrackSidebarHiddenMac,
          )}
        >
          {workbenchOpen && (
            <>
              <WorkbenchTabStrip
                viewKey={workbenchView}
                view={view}
                scope={workbenchScope}
                workspacePath={workspace.path}
              />
              <Hint
                content={view.maximized ? "Restore Workbench Width" : "Expand Workbench"}
                trigger={
                  <Toggle
                    iconOnly
                    icon={view.maximized ? "minimize" : "expand"}
                    aria-label={view.maximized ? "Restore workbench width" : "Expand workbench"}
                    pressed={view.maximized}
                    onPressedChange={() =>
                      workbenchController.actions.toggleMaximized({ view: workbenchView })
                    }
                    title={undefined}
                  />
                }
              />
            </>
          )}
          <Hint
            content={`${workbenchOpen ? "Close Workbench Panel" : "Open Workbench Panel"} ${clientActionShortcut(clientActions.workbench, true)}`}
            trigger={
              <Toggle
                iconOnly
                aria-label={workbenchOpen ? "Close workbench panel" : "Open workbench panel"}
                pressed={workbenchOpen}
                onPressedChange={() =>
                  workbenchController.actions.toggleWorkbench({
                    view: workbenchView,
                    scope: workbenchScope,
                  })
                }
                title={undefined}
              >
                <PanelToggleIcon side="right" visible={workbenchOpen} />
              </Toggle>
            }
          />
        </div>
      </header>
      <div {...props(threadStyles.body)}>
        <div
          data-sidebar-seat=""
          aria-hidden={!sidebarVisible}
          inert={!sidebarVisible}
          {...props(fixture.sidebarSeat)}
        >
          <aside
            aria-label="Sessions and workspaces"
            data-lab-sidebar=""
            {...props(sidebarStyles.rail, fixture.sidebar, fixture.sidebarSlide)}
          >
            <div {...props(sidebarStyles.primaryActions)}>
              <Row
                variant="nav"
                xstyle={sidebarStyles.navRow}
                onClick={() => {
                  setSessions((current) => [
                    "New chat",
                    ...current.filter((title) => title !== "New chat"),
                  ]);
                  setSelected("New chat");
                }}
              >
                <Row.Leading>
                  <Icon name="new-chat" size={14} />
                </Row.Leading>
                <Row.Label>New Chat</Row.Label>
                <span {...props(sidebarStyles.shortcutSlot, sidebarStyles.shortcutPersistent)}>
                  <Kbd keys={["⌘", "N"]} />
                </span>
              </Row>
              <Row variant="nav" xstyle={sidebarStyles.navRow}>
                <Row.Leading>
                  <Icon name="search" size={14} />
                </Row.Leading>
                <Row.Label>Search</Row.Label>
              </Row>
              <Row variant="nav" xstyle={sidebarStyles.navRow}>
                <Row.Leading>
                  <Icon name="customize" size={14} />
                </Row.Leading>
                <Row.Label>Customize</Row.Label>
              </Row>
            </div>
            <div {...props(sidebarStyles.scroll)} data-grid-scroll="">
              <section {...props(sidebarStyles.section)}>
                <div {...props(sidebarStyles.sectionHeader)}>
                  <span {...props(sidebarStyles.sectionToggle)}>Workspaces</span>
                  <Button size="sm" iconOnly icon="filters" aria-label="Filter workspaces" />
                  <Button size="sm" iconOnly icon="folder-add" aria-label="Add workspace" />
                </div>
                <Row xstyle={[sidebarStyles.rowSurface, sidebarStyles.workspaceRow]}>
                  <Row.Leading xstyle={sidebarStyles.rowIcon}>
                    <Icon name="folder" size={14} />
                  </Row.Leading>
                  <Row.Label>nyte</Row.Label>
                </Row>
                <SessionContext
                  surface={surface}
                  onSurface={onSurface}
                  pinned={pinned.has(selected)}
                  onPin={() => togglePin(selected)}
                  onArchive={() => archive(selected)}
                  trigger={
                    <div {...props(sidebarStyles.sessionList)}>
                      {sessions.map((title, index) => (
                        <Row
                          key={title}
                          data-grid-row="session"
                          data-demo-context-target={title === selected ? "" : undefined}
                          onContextMenu={() => setSelected(title)}
                          revealActions
                          xstyle={[
                            sidebarStyles.rowSurface,
                            sidebarStyles.sessionRow,
                            title === selected && sidebarStyles.rowSelected,
                          ]}
                        >
                          {title === selected && (
                            <Row.Backdrop xstyle={sidebarStyles.sessionSelection} />
                          )}
                          <Row.Primary onClick={() => setSelected(title)}>
                            <Row.Leading
                              data-grid-column="sidebar.icons"
                              xstyle={[sidebarStyles.rowIcon, index < 2 && fixture.activity]}
                            >
                              {index < 2 ? (
                                <Spinner />
                              ) : pinned.has(title) ? (
                                <Icon name="pin" size={14} />
                              ) : null}
                            </Row.Leading>
                            <Row.Label
                              data-grid-text=""
                              data-grid-column="sidebar.labels"
                              xstyle={sidebarStyles.sessionLabel}
                            >
                              {title}
                            </Row.Label>
                            <Row.Meta
                              data-grid-column="sidebar.time"
                              xstyle={sidebarStyles.rowMeta}
                            >
                              {index < 3 ? "now" : index === 3 ? "34m" : `${index}h`}
                            </Row.Meta>
                          </Row.Primary>
                          <Row.Actions
                            placement="overlay"
                            xstyle={[sidebarStyles.rowActions, sidebarStyles.rowActionsBesideMeta]}
                          >
                            <Button
                              size="2xs"
                              iconOnly
                              icon="pin"
                              aria-label={`${pinned.has(title) ? "Unpin" : "Pin"} ${title}`}
                              onClick={() => togglePin(title)}
                            />
                            <Button
                              size="2xs"
                              iconOnly
                              aria-label={`Archive ${title}`}
                              onClick={() => archive(title)}
                            >
                              <span {...props(sidebarStyles.actionGlyphArchive)}>
                                <Icon name="archive" size={12} />
                              </span>
                            </Button>
                          </Row.Actions>
                        </Row>
                      ))}
                    </div>
                  }
                />
              </section>
            </div>
            <div {...props(sidebarStyles.footer)}>
              <div {...props(sidebarStyles.footerRow)}>
                <Row variant="nav" xstyle={[sidebarStyles.navRow, sidebarStyles.accountButton]}>
                  <Row.Leading>
                    <Icon name="user" size={14} />
                  </Row.Leading>
                  <Row.Label>Itsnotaka</Row.Label>
                </Row>
                <Hint
                  content="Settings"
                  side="top"
                  trigger={
                    <Button
                      iconOnly
                      icon="settings"
                      aria-label="Settings"
                      onClick={() => onSurface("menu")}
                      title={undefined}
                    />
                  }
                />
              </div>
            </div>
          </aside>
        </div>
        <div {...props(threadStyles.stage)}>
          <main {...props(threadStyles.conversation, fixture.main)}>
            <div
              ref={setScroll}
              data-grid-scroll=""
              data-nyte-scrollport="balanced"
              {...props(threadStyles.scroll)}
            >
              <div {...props(threadStyles.transcript, fixture.transcript)}>
                {turns.map((turn, index) => (
                  <div
                    key={turn.kind === "turn" ? turn.id : index}
                    data-lab-turn=""
                    data-grid-row="turn"
                    {...props(
                      threadStyles.row,
                      index === 0 && threadStyles.rowFirst,
                      fixture.flowRow,
                    )}
                  >
                    <TurnView
                      turn={turn}
                      liveTools={noLiveTools}
                      cwd={workspace.path}
                      onOpenChanges={() => applyWorkbenchState("panel")}
                      running={false}
                      waits={NO_WAITS}
                    />
                  </div>
                ))}
              </div>
              <div {...props(composerStyles.dock)}>
                <div
                  role="region"
                  aria-label="Conversation input"
                  {...props(composerStyles.region)}
                >
                  <div {...props(composerStyles.inputStack)}>
                    <div {...props(composerStyles.preComposerOverlay)}>
                      <SubagentTray
                        parentSessionId={parentSessionId}
                        agents={subagents}
                        view={trayView}
                        onViewChange={setTrayView}
                        onExpand={() => setTrayView({ kind: "closed" })}
                        onRelease={() => replyRef.current?.focus({ preventScroll: true })}
                        viewport={scroll}
                        detail={
                          trayView.kind === "detail" ? (
                            <div {...props(threadStyles.scroll)}>
                              <div {...props(threadStyles.transcript, fixture.transcript)}>
                                <div
                                  {...props(
                                    threadStyles.row,
                                    threadStyles.rowFirst,
                                    fixture.flowRow,
                                  )}
                                >
                                  <TurnView
                                    turn={turns[0]}
                                    liveTools={noLiveTools}
                                    cwd={workspace.path}
                                    onOpenChanges={() => {}}
                                    running={false}
                                    waits={NO_WAITS}
                                  />
                                </div>
                              </div>
                            </div>
                          ) : null
                        }
                      />
                    </div>
                    <div
                      ref={composerRef}
                      data-grid-row="composer"
                      {...props(composerStyles.frame, composerStyles.frameFollowUpCompact)}
                    >
                      <div {...props(composerStyles.layout, composerStyles.layoutCompact)}>
                        <div {...props(composerStyles.editor, composerStyles.editorCompact)}>
                          <textarea
                            ref={replyRef}
                            aria-label="Message Nyte"
                            placeholder="Message Nyte"
                            rows={1}
                            value={reply}
                            onChange={(event) => setReply(event.currentTarget.value)}
                            {...props(composerStyles.input, composerStyles.inputCompact)}
                          />
                        </div>
                        <div {...props(composerStyles.controls, composerStyles.controlsCompact)}>
                          <DemoPopover
                            surface={surface}
                            onSurface={onSurface}
                            anchor={composerRef}
                            onChoose={setReply}
                            trigger={
                              <Button
                                iconOnly
                                icon="plus"
                                aria-label="Add agents, context, tools"
                                variant="secondary"
                                round
                                xstyle={composerStyles.addButtonCompact}
                              />
                            }
                          />
                          <span
                            {...props(composerStyles.modelSlot, composerStyles.modelSlotCompact)}
                          >
                            <DemoModelPicker />
                          </span>
                          <Button
                            iconOnly
                            icon="arrow-up"
                            aria-label="Send message"
                            variant="inverse"
                            round
                            disabled={reply.length === 0}
                            onClick={() => setReply("")}
                            xstyle={composerStyles.sendCompact}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
          <Workbench workspacePath={workspace.path} sessionId={undefined} />
        </div>
      </div>
      <DemoDialog
        surface={surface}
        onSurface={onSurface}
        returnFocusRef={menuRef}
        onConfirm={() => archive(selected)}
      />
      <GridOverlay {...grid} />
    </div>
  );
}
