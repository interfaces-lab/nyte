import { create, props } from "@stylexjs/stylex";
import { Row } from "@nyte-ai/ui/row";
import { Button } from "@nyte-ai/ui";
import { useRef, useState } from "react";
import { sidebarStyles } from "../../../desktop/src/renderer/src/chrome/sidebar.stylex.ts";
import { titlebarStyles } from "../../../desktop/src/renderer/src/chrome/titlebar.stylex.ts";
import { threadStyles } from "../../../desktop/src/renderer/src/screens/thread.stylex.ts";
import { workbenchStyles } from "../../../desktop/src/renderer/src/workbench/workbench.stylex.ts";
import {
  composerStyles,
  proseStyles,
  turnStyles,
} from "../../../desktop/src/renderer/src/conversation/styles.stylex.ts";
import { Icon, PanelToggleIcon } from "../../../desktop/src/renderer/src/components/icons.tsx";
import type { IconName } from "../../../desktop/src/renderer/src/components/icons.tsx";
import { Hint, IconButton, Kbd, focus } from "../../../desktop/src/renderer/src/components/ui.tsx";
import { t } from "../../../desktop/src/renderer/src/theme/vars.stylex.ts";
import { Spinner } from "../../../desktop/src/renderer/src/components/spinner.tsx";
import { PaneMenu, SessionContext, DemoPopover, DemoDialog } from "./demo-surfaces";
import type { AuditSurface } from "./audit-state";
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
    backgroundColor: t.bgSidebar,
    color: t.textPrimary,
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
  hidden: { display: "none" },
  sidebar: {
    position: "relative",
    "::after": {
      content: "''",
      position: "absolute",
      insetBlock: 0,
      insetInlineEnd: 0,
      width: 1,
      backgroundColor: t.strokeQuaternary,
      pointerEvents: "none",
    },
  },
  activity: { color: t.textAccent },
  workbench: {
    width: "var(--nyte-workbench-rail-width)",
    minWidth: "var(--nyte-workbench-rail-width)",
  },
});

const navigation = [
  { label: "Files", icon: "file" },
  { label: "Changes", icon: "git-branch" },
  { label: "Browser", icon: "globe" },
  { label: "Terminal", icon: "console" },
  { label: "Agents", icon: "robot" },
] satisfies { label: string; icon: IconName }[];

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
  grid,
}: {
  sidebarVisible: boolean;
  onSidebar: () => void;
  surface: AuditSurface;
  onSurface: (surface: AuditSurface) => void;
  grid: GridMetrics;
}) {
  const [workbenchVisible, setWorkbenchVisible] = useState(true);
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
  const [openTab, setOpenTab] = useState<string>();

  return (
    <div id="lab-shell" data-desktop-demo="" {...props(fixture.root)}>
      <header data-grid-row="titlebar" {...props(titlebarStyles.bar, titlebarStyles.barMac)}>
        <div
          {...props(
            titlebarStyles.contentFill,
            !sidebarVisible && titlebarStyles.contentFillSidebarHidden,
          )}
        />
        <span aria-hidden="true" {...props(fixture.lights)}>
          <i {...props(fixture.light, fixture.red)} />
          <i {...props(fixture.light, fixture.yellow)} />
          <i {...props(fixture.light, fixture.green)} />
        </span>
        <span {...props(titlebarStyles.actionTrack)}>
          <IconButton
            label="Toggle sidebar"
            onClick={onSidebar}
            icon={<PanelToggleIcon side="left" visible={sidebarVisible} />}
          />
        </span>
        {sidebarVisible && (
          <span {...props(titlebarStyles.navigationTrack)}>
            <IconButton icon="arrow-left" label="Back" />
            <IconButton icon="arrow-right" label="Forward" disabled />
          </span>
        )}
        <span
          {...props(
            titlebarStyles.titleSlot,
            !sidebarVisible && titlebarStyles.titleSlotSidebarHiddenMac,
          )}
        >
          <span {...props(titlebarStyles.sessionTitleGroup)}>
            <span {...props(titlebarStyles.sessionTitle)}>{selected}</span>
          </span>
        </span>
        <span {...props(titlebarStyles.spacer)} />
        <span {...props(titlebarStyles.actionTrack)}>
          <PaneMenu
            surface={surface}
            onSurface={onSurface}
            trigger={<IconButton ref={menuRef} icon="more" label="Pane actions" />}
          />
        </span>
        <span {...props(titlebarStyles.actionTrack)}>
          <Hint
            content="Toggle workbench"
            trigger={
              <IconButton
                label="Toggle workbench"
                onClick={() => setWorkbenchVisible(!workbenchVisible)}
                icon={<PanelToggleIcon side="right" visible={workbenchVisible} />}
              />
            }
          />
        </span>
      </header>
      <div {...props(threadStyles.body)}>
        <aside
          aria-label="Sessions and workspaces"
          data-lab-sidebar=""
          hidden={!sidebarVisible}
          {...props(sidebarStyles.rail, fixture.sidebar, !sidebarVisible && fixture.hidden)}
        >
          <div {...props(sidebarStyles.primaryActions)}>
            <button
              type="button"
              {...props(sidebarStyles.navRow)}
              onClick={() => {
                setSessions((current) => [
                  "New chat",
                  ...current.filter((title) => title !== "New chat"),
                ]);
                setSelected("New chat");
              }}
            >
              <span {...props(sidebarStyles.navIcon)}>
                <Icon name="new-chat" size={14} />
              </span>
              <span {...props(sidebarStyles.navLabel)}>New Chat</span>
              <span {...props(sidebarStyles.shortcutSlot, sidebarStyles.shortcutPersistent)}>
                <Kbd keys={["⌘", "N"]} />
              </span>
            </button>
            <button type="button" {...props(sidebarStyles.navRow)}>
              <span {...props(sidebarStyles.navIcon)}>
                <Icon name="search" size={14} />
              </span>
              <span {...props(sidebarStyles.navLabel)}>Search</span>
            </button>
            <button type="button" {...props(sidebarStyles.navRow)}>
              <span {...props(sidebarStyles.navIcon)}>
                <Icon name="customize" size={14} />
              </span>
              <span {...props(sidebarStyles.navLabel)}>Customize</span>
            </button>
          </div>
          <div {...props(sidebarStyles.scroll)} data-grid-scroll="">
            <section {...props(sidebarStyles.section)}>
              <div {...props(sidebarStyles.sectionHeader)}>
                <span {...props(sidebarStyles.sectionToggle)}>Workspaces</span>
                <button
                  type="button"
                  aria-label="Filter workspaces"
                  {...props(sidebarStyles.action)}
                >
                  <Icon name="filters" size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Add workspace"
                  {...props(sidebarStyles.workspaceCreateAction)}
                >
                  <Icon name="folder-add" size={14} />
                </button>
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
                        <Row.Primary
                          render={<button type="button" onClick={() => setSelected(title)} />}
                        >
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
                          <Row.Meta data-grid-column="sidebar.time" xstyle={sidebarStyles.rowMeta}>
                            {index < 3 ? "now" : index === 3 ? "34m" : `${index}h`}
                          </Row.Meta>
                        </Row.Primary>
                        <Row.Actions
                          placement="overlay"
                          xstyle={[sidebarStyles.rowActions, sidebarStyles.rowActionsBesideMeta]}
                        >
                          <button
                            type="button"
                            aria-label={`${pinned.has(title) ? "Unpin" : "Pin"} ${title}`}
                            onClick={() => togglePin(title)}
                            {...props(
                              sidebarStyles.action,
                              sidebarStyles.sessionAction,
                              focus.ringInset,
                            )}
                          >
                            <Icon name="pin" size={12} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Archive ${title}`}
                            onClick={() => archive(title)}
                            {...props(
                              sidebarStyles.action,
                              sidebarStyles.sessionAction,
                              focus.ringInset,
                            )}
                          >
                            <span {...props(sidebarStyles.actionGlyphArchive)}>
                              <Icon name="archive" size={12} />
                            </span>
                          </button>
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
              <button type="button" {...props(sidebarStyles.navRow, sidebarStyles.accountButton)}>
                <span {...props(sidebarStyles.navIcon)}>
                  <Icon name="user" size={14} />
                </span>
                <span {...props(sidebarStyles.navLabel)}>Itsnotaka</span>
              </button>
              <Hint
                content="Settings"
                side="top"
                trigger={
                  <button
                    type="button"
                    aria-label="Settings"
                    {...props(sidebarStyles.footerSettings)}
                    onClick={() => onSurface("menu")}
                  >
                    <Icon name="settings" size={14} />
                  </button>
                }
              />
            </div>
          </div>
        </aside>
        <main {...props(threadStyles.conversation, fixture.main)}>
          <div data-grid-scroll="" {...props(threadStyles.scroll)}>
            <div {...props(threadStyles.transcript, fixture.transcript)}>
              <div
                data-grid-row="assistant"
                {...props(threadStyles.row, threadStyles.rowFirst, fixture.flowRow)}
              >
                <div
                  data-grid-column="conversation"
                  {...props(proseStyles.root, proseStyles.measure)}
                >
                  <p data-grid-text="" {...props(proseStyles.paragraph)}>
                    I checked VS Code's actual browser, trust, and chat-storage source, plus
                    Cursor's cleanup code. Trust checks remain intact.
                  </p>
                  <p data-grid-text="" {...props(proseStyles.paragraph)}>
                    Targeted tests and the full client suite pass. Broader typecheck/lint checks
                    still hit unrelated changes currently underway.
                  </p>
                  <p data-grid-text="" {...props(proseStyles.paragraph)}>
                    <strong {...props(proseStyles.strong)}>Still outstanding:</strong> repeated
                    full-history scans and some core session/plugin state retained until workspace
                    shutdown.
                    <br />
                    This is not yet a complete performance fix, and I haven't measured savings in a
                    rebuilt desktop app.
                  </p>
                </div>
              </div>
              <div data-grid-row="user" {...props(threadStyles.row, fixture.flowRow)}>
                <div {...props(turnStyles.userRow)}>
                  <div {...props(turnStyles.userPromptShell)}>
                    <div data-grid-column="conversation" {...props(turnStyles.userPrompt)}>
                      <span {...props(composerStyles.mentionChip, composerStyles.mentionChipSkill)}>
                        <span {...props(composerStyles.mentionChipLeading)}>
                          <Icon name="skills" size={12} />
                        </span>
                        /bro
                      </span>{" "}
                      no, we should improve those logic if needed. and archive stop resources is
                      just what I made up, keep
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div {...props(composerStyles.dock)}>
              <div {...props(composerStyles.region)}>
                <div
                  ref={composerRef}
                  data-grid-row="composer"
                  {...props(composerStyles.frame, composerStyles.frameFollowUpCompact)}
                >
                  <div {...props(composerStyles.layout, composerStyles.layoutCompact)}>
                    <div {...props(composerStyles.editor, composerStyles.editorCompact)}>
                      <textarea
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
                            unstyled
                            aria-label="Add agents, context, tools"
                            {...props(
                              composerStyles.addButton,
                              composerStyles.controlHitArea,
                              composerStyles.addButtonCompact,
                              focus.ring,
                            )}
                          >
                            <Icon name="plus" />
                          </Button>
                        }
                      />
                      <span {...props(composerStyles.modelSlot, composerStyles.modelSlotCompact)} />
                      <Button
                        unstyled
                        aria-label="Send message"
                        disabled={reply.length === 0}
                        onClick={() => setReply("")}
                        {...props(
                          composerStyles.send,
                          composerStyles.controlHitArea,
                          composerStyles.sendCompact,
                          focus.ring,
                        )}
                      >
                        <Icon name="arrow-up" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
        <div
          hidden={!workbenchVisible}
          {...props(workbenchStyles.root, fixture.workbench, !workbenchVisible && fixture.hidden)}
        >
          <nav aria-label="Workbench navigation" {...props(workbenchStyles.rail)}>
            <section {...props(workbenchStyles.railSection)}>
              <div data-grid-row="workbench-heading" {...props(workbenchStyles.railHeading)}>
                <span {...props(workbenchStyles.railHeadingText)}>Open Tabs</span>
                <Button
                  unstyled
                  aria-label="Collapse workbench"
                  onClick={() => setWorkbenchVisible(false)}
                  {...props(workbenchStyles.chevron, focus.ring)}
                >
                  <span {...props(workbenchStyles.doubleChevron)}>
                    <Icon name="chevron-right" size={11} />
                    <span {...props(workbenchStyles.doubleChevronTrail)}>
                      <Icon name="chevron-right" size={11} />
                    </span>
                  </span>
                </Button>
              </div>
              {openTab !== undefined && (
                <Button
                  unstyled
                  onClick={() => setOpenTab(undefined)}
                  {...props(workbenchStyles.railRow)}
                >
                  <span {...props(workbenchStyles.railLabel)}>{openTab}</span>
                  <Icon name="x" size={14} />
                </Button>
              )}
            </section>
            <section {...props(workbenchStyles.railSection)}>
              <div data-grid-row="workbench-heading" {...props(workbenchStyles.railHeading)}>
                <span {...props(workbenchStyles.railHeadingText)}>On nyte</span>
              </div>
              {navigation.map((item) => (
                <Button
                  unstyled
                  key={item.label}
                  data-grid-row="workbench"
                  onClick={() => setOpenTab(item.label)}
                  {...props(workbenchStyles.railRow, focus.ring)}
                >
                  <span data-grid-column="workbench.icons" {...props(workbenchStyles.railIcon)}>
                    <Icon name={item.icon} size={14} />
                  </span>
                  <span
                    data-grid-text=""
                    data-grid-column="workbench.labels"
                    {...props(workbenchStyles.railLabel)}
                  >
                    {item.label}
                  </span>
                  {item.label === "Changes" && (
                    <span {...props(workbenchStyles.railStats)}>
                      <span {...props(workbenchStyles.railAdded)}>+149</span>
                      <span {...props(workbenchStyles.railRemoved)}>-35</span>
                    </span>
                  )}
                </Button>
              ))}
            </section>
          </nav>
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
