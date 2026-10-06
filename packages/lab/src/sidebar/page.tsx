/**
 * Inbox for the sidebar: the same chats drawn three ways, driven by one set of
 * moves, so a reply landing or a run finishing can be watched in each.
 *
 * Today is the shipped rail. A makes Inbox the default grouping: what needs
 * you stays open and Working and Done fold beneath it. B is the Status
 * filter's new Inbox Only preset, which hides instead of folding. Both live in
 * the same menu, so each rail can be switched to the others from its filter.
 */
import { create, props } from "@stylexjs/stylex";
import { LayoutGroup, MotionConfig } from "motion/react";
import { useState, useSyncExternalStore, type ReactElement } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";
import { sidebarStyles as rail } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import type { SessionStatus } from "@nyte-ai/app/chrome/sidebar-view.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { sessionActivityMark } from "@nyte-ai/app/session-activity.ts";
import { SessionReadState, type ReadSessions } from "@nyte-ai/app/session-read-state.ts";
import { sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import {
  askQuestion,
  blankChat,
  finishRun,
  latestRunStart,
  seedChats,
  seedDrafts,
  sendMessage,
  type ComposerDraft,
} from "./fixtures";
import {
  INBOX_STATUSES,
  railRows,
  sessionStatus,
  shelfOf,
  type Hold,
  type RailView,
  type ShelfName,
} from "./inbox";
import {
  ChatGlyph,
  ChatRow,
  ChatsMenu,
  chatTitle,
  ComposerDraftRow,
  RailFrame,
  Shelf,
  type ArchiveButton,
} from "./rail";

const VARIANTS = [
  {
    scope: "today",
    name: "Today",
    note: "One list ranked by status. A chat stays until you archive it.",
    view: { grouping: "none", statuses: [], archived: false },
  },
  {
    scope: "inbox",
    name: "A · Inbox grouping (default)",
    note: "What needs you stays open. Working and Done fold beneath it.",
    view: { grouping: "inbox", statuses: [], archived: false },
  },
  {
    scope: "only",
    name: "B · Inbox Only filter",
    note: "A Status preset. Working and Done are hidden, not folded.",
    view: { grouping: "none", statuses: INBOX_STATUSES, archived: false },
  },
] as const satisfies readonly {
  readonly scope: string;
  readonly name: string;
  readonly note: string;
  readonly view: RailView;
}[];

const SHELF_LABELS = {
  inbox: "Inbox",
  working: "Working",
  done: "Done",
  archived: "Archived",
} as const satisfies Readonly<Record<ShelfName, string>>;

const STATUS_TEXT = {
  "needs-attention": "Needs attention",
  unread: "Unread",
  working: "Working",
  draft: "Draft",
  done: "Done",
} as const satisfies Readonly<Record<SessionStatus, string>>;

const FOLLOW_UP = "Pick this back up and finish the tests.";

const QUESTION = "Use the existing Dialog or the lab one?";

interface Board {
  readonly sessions: readonly SessionInfo[];
  readonly drafts: readonly ComposerDraft[];
  readonly openId: SessionId | undefined;
  readonly hold: Hold | undefined;
  /** Receipts live in the board, not this window's storage, so Reset starts clean. */
  readonly readState: SessionReadState;
}

function seedBoard(): Board {
  const now = Date.now();
  const { sessions, opened } = seedChats(now);
  const readState = new SessionReadState();

  for (const session of opened) readState.markRead(session);

  return { sessions, drafts: seedDrafts(now), openId: undefined, hold: undefined, readState };
}

interface RailActions {
  readonly open: (session: SessionInfo) => void;
  readonly pin: (session: SessionInfo) => void;
  readonly archive: (session: SessionInfo) => void;
  readonly newChat: () => void;
  readonly deleteDraft: (id: string) => void;
}

function ChatsRail({
  scope,
  label,
  initialView,
  sessions,
  drafts,
  read,
  hold,
  openId,
  archiveButton,
  actions,
}: {
  readonly scope: string;
  readonly label: string;
  readonly initialView: RailView;
  readonly sessions: readonly SessionInfo[];
  readonly drafts: readonly ComposerDraft[];
  readonly read: ReadSessions;
  readonly hold: Hold | undefined;
  readonly openId: SessionId | undefined;
  readonly archiveButton: ArchiveButton;
  readonly actions: RailActions;
}): ReactElement {
  const [view, setView] = useState<RailView>(initialView);
  const rows = railRows(sessions, view, read, hold);
  const filtersActive = view.statuses.length > 0 || view.archived;
  const showDrafts = view.statuses.length === 0 || view.statuses.includes("draft");

  const draftRows = (showDrafts ? drafts : []).map((draft) => (
    <ComposerDraftRow
      key={draft.id}
      draft={draft}
      scope={scope}
      onDelete={() => actions.deleteDraft(draft.id)}
    />
  ));

  const chatRow = (session: SessionInfo): ReactElement => (
    <ChatRow
      key={session.sessionId}
      session={session}
      read={read}
      scope={scope}
      selected={session.sessionId === openId}
      archiveButton={archiveButton}
      onOpen={() => actions.open(session)}
      onPin={() => actions.pin(session)}
      onArchive={() => actions.archive(session)}
    />
  );

  const quiet = (message: string): ReactElement => (
    <div {...props(rail.quiet, rail.sessionQuiet)}>{message}</div>
  );

  return (
    <RailFrame label={label}>
      <div {...props(rail.primaryActions)}>
        <Row variant="nav" xstyle={rail.navRow} onClick={actions.newChat}>
          <Row.Leading xstyle={rail.navLeading}>
            <Icon name="new-chat" size={14} />
          </Row.Leading>
          <Row.Label>New Chat</Row.Label>
        </Row>
      </div>
      <LayoutGroup id={scope}>
        <div {...props(rail.scroll)}>
          <section aria-label="Chats" {...props(rail.section)}>
            <div {...props(rail.sectionHeader)}>
              <span {...props(rail.sectionToggle)}>
                <span {...props(rail.sectionLabel)}>Chats</span>
              </span>
              <ChatsMenu value={view} onChange={setView} />
            </div>
            {rows.kind === "list" ? (
              <div {...props(rail.section)}>
                {draftRows}
                {rows.sessions.map(chatRow)}
                {rows.sessions.length === 0 &&
                  draftRows.length === 0 &&
                  (filtersActive ? (
                    <>
                      {quiet("No chats match these filters")}
                      <Row
                        variant="nav"
                        xstyle={rail.showMore}
                        onClick={() => setView({ ...view, statuses: [], archived: false })}
                      >
                        Clear Filters
                      </Row>
                    </>
                  ) : (
                    quiet("No chats yet")
                  ))}
              </div>
            ) : (
              <>
                <div {...props(rail.section)}>
                  {draftRows}
                  {rows.shelves.inbox.map(chatRow)}
                  {rows.shelves.inbox.length === 0 &&
                    draftRows.length === 0 &&
                    quiet("Nothing new")}
                </div>
                {rows.shelves.working.length > 0 && (
                  <Shelf
                    key="working"
                    label="Working"
                    count={rows.shelves.working.length}
                    leading={<StatusDot mark="working" />}
                  >
                    {rows.shelves.working.map(chatRow)}
                  </Shelf>
                )}
                {rows.shelves.done.length > 0 && (
                  <Shelf
                    key="done"
                    label="Done"
                    count={rows.shelves.done.length}
                    leading={<Icon name="inbox-checked" size={14} />}
                  >
                    {rows.shelves.done.map(chatRow)}
                  </Shelf>
                )}
                {rows.shelves.archived.length > 0 && (
                  <Shelf
                    key="archived"
                    label="Archived"
                    count={rows.shelves.archived.length}
                    leading={<Icon name="archive" size={14} />}
                  >
                    {rows.shelves.archived.map(chatRow)}
                  </Shelf>
                )}
              </>
            )}
          </section>
        </div>
      </LayoutGroup>
    </RailFrame>
  );
}

function OpenChat({
  session,
  read,
  hold,
  onSend,
  onFinish,
  onArchive,
  onClose,
}: {
  readonly session: SessionInfo | undefined;
  readonly read: ReadSessions;
  readonly hold: Hold | undefined;
  readonly onSend: () => void;
  readonly onFinish: () => void;
  readonly onArchive: () => void;
  readonly onClose: () => void;
}): ReactElement {
  if (session === undefined) {
    return (
      <aside aria-label="Open chat" {...props(styles.open)}>
        <p {...props(styles.openNote)}>
          Open a chat in any rail. It keeps its place until you open another.
        </p>
      </aside>
    );
  }

  const status = sessionStatus(session, read);
  const natural = shelfOf(session, read, undefined);
  const held = hold?.sessionId === session.sessionId && hold.shelf !== natural ? hold : undefined;

  return (
    <aside aria-label="Open chat" {...props(styles.open)}>
      <div {...props(styles.openTitle)}>
        <span {...props(styles.openGlyph)}>
          <ChatGlyph session={session} read={read} />
        </span>
        <span {...props(styles.openTitleText)}>{chatTitle(session)}</span>
      </div>
      <dl {...props(styles.facts)}>
        <dt {...props(styles.factTerm)}>Status</dt>
        <dd {...props(styles.factValue)}>{session.archived ? "Archived" : STATUS_TEXT[status]}</dd>
        <dt {...props(styles.factTerm)}>Inbox shelf</dt>
        <dd {...props(styles.factValue)}>{SHELF_LABELS[held?.shelf ?? natural]}</dd>
      </dl>
      {held !== undefined && (
        <p {...props(styles.openNote)}>
          Held in {SHELF_LABELS[held.shelf]} while open. It moves to {SHELF_LABELS[natural]} when
          you open another chat.
        </p>
      )}
      <div {...props(styles.openActions)}>
        <Button size="sm" variant="outline" onClick={onSend}>
          Send Follow-Up
        </Button>
        {status === "working" && (
          <Button size="sm" variant="outline" onClick={onFinish}>
            Finish Run
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onArchive}>
          {session.archived ? "Restore Chat" : "Archive Chat"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close Chat
        </Button>
      </div>
    </aside>
  );
}

export function SidebarPage(): ReactElement {
  const [board, setBoard] = useState(seedBoard);
  const [generation, setGeneration] = useState(0);
  const [archiveButton, setArchiveButton] = useState<ArchiveButton>("hover");
  const read = useSyncExternalStore(board.readState.subscribe, board.readState.getSnapshot);
  const open = board.sessions.find((session) => session.sessionId === board.openId);

  /** The newest run outside the open chat: the one a glance at the rail would catch. */
  const latestWorking = board.sessions
    .filter(
      (session) =>
        session.sessionId !== board.openId &&
        !session.archived &&
        sessionActivityMark(session, false) === "working",
    )
    .toSorted((left, right) => latestRunStart(right) - latestRunStart(left))[0];

  const replace = (next: SessionInfo): void => {
    setBoard((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.sessionId === next.sessionId ? next : session,
      ),
    }));

    // The open chat is on screen, so whatever lands in it is read.
    if (next.sessionId === board.openId) board.readState.markRead(next);
  };

  const actions: RailActions = {
    open: (session) => {
      setBoard((current) => ({
        ...current,
        openId: session.sessionId,
        hold: { sessionId: session.sessionId, shelf: shelfOf(session, read, undefined) },
      }));
      board.readState.markRead(session);
    },
    pin: (session) => replace({ ...session, pinned: !session.pinned }),
    archive: (session) => replace({ ...session, archived: !session.archived }),
    newChat: () => {
      const session = blankChat(Date.now());

      setBoard((current) => ({
        ...current,
        sessions: [session, ...current.sessions],
        openId: session.sessionId,
        hold: { sessionId: session.sessionId, shelf: "inbox" },
      }));
    },
    deleteDraft: (id) =>
      setBoard((current) => ({
        ...current,
        drafts: current.drafts.filter((draft) => draft.id !== id),
      })),
  };

  return (
    <MotionConfig reducedMotion="user">
      <main {...props(styles.page)}>
        <div {...props(styles.column)}>
          <header {...props(styles.header)}>
            <h1 {...props(styles.title)}>Sidebar inbox</h1>
            <p {...props(styles.lede)}>
              The rail shows what needs you. Running and finished chats fold away until they do.
            </p>
          </header>

          <div role="toolbar" aria-label="Simulate" {...props(styles.toolbar)}>
            <span {...props(styles.toolbarLabel)}>Simulate</span>
            <Button
              size="sm"
              variant="outline"
              disabled={latestWorking === undefined}
              onClick={() => {
                if (latestWorking !== undefined) replace(finishRun(latestWorking, Date.now()));
              }}
            >
              Finish a Run
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={latestWorking === undefined}
              onClick={() => {
                if (latestWorking !== undefined)
                  replace(askQuestion(latestWorking, QUESTION, Date.now()));
              }}
            >
              Ask a Question
            </Button>
            <Button size="sm" variant="outline" onClick={actions.newChat}>
              New Chat
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setBoard(seedBoard());
                setGeneration((current) => current + 1);
              }}
            >
              Reset
            </Button>
            <span {...props(styles.toolbarSpacer)} />
            <span {...props(styles.toolbarLabel)}>Archive button</span>
            <ToggleGroup
              aria-label="Archive button"
              value={[archiveButton]}
              onValueChange={(values) => {
                const next = values.at(-1);

                if (next === "hover" || next === "always") setArchiveButton(next);
              }}
            >
              <Toggle value="hover">On Hover</Toggle>
              <Toggle value="always">Always</Toggle>
            </ToggleGroup>
          </div>

          <div {...props(styles.board)}>
            {VARIANTS.map((variant) => (
              <section key={variant.scope} {...props(styles.variant)}>
                <header {...props(styles.variantHeader)}>
                  <h2 {...props(styles.variantName)}>{variant.name}</h2>
                  <p {...props(styles.variantNote)}>{variant.note}</p>
                </header>
                <div {...props(styles.railSlot)}>
                  <ChatsRail
                    // Reset remounts each rail so its filter returns to the variant's.
                    key={`${variant.scope}-${String(generation)}`}
                    scope={variant.scope}
                    label={`${variant.name} sidebar`}
                    initialView={variant.view}
                    sessions={board.sessions}
                    drafts={board.drafts}
                    read={read}
                    hold={board.hold}
                    openId={board.openId}
                    archiveButton={archiveButton}
                    actions={actions}
                  />
                </div>
              </section>
            ))}
            <section {...props(styles.variant, styles.openColumn)}>
              <header {...props(styles.variantHeader)}>
                <h2 {...props(styles.variantName)}>Open chat</h2>
                <p {...props(styles.variantNote)}>One pane behind all three rails.</p>
              </header>
              <OpenChat
                session={open}
                read={read}
                hold={board.hold}
                onSend={() => {
                  if (open !== undefined) replace(sendMessage(open, FOLLOW_UP, Date.now()));
                }}
                onFinish={() => {
                  if (open !== undefined) replace(finishRun(open, Date.now()));
                }}
                onArchive={() => {
                  if (open !== undefined) actions.archive(open);
                }}
                onClose={() =>
                  setBoard((current) => ({ ...current, openId: undefined, hold: undefined }))
                }
              />
            </section>
          </div>

          <div {...props(styles.notes)}>
            <section {...props(styles.note)}>
              <h2 {...props(styles.noteTitle)}>Rules</h2>
              <ul {...props(styles.list)}>
                <li>Inbox holds questions, failures, unread replies, drafts, and pinned chats.</li>
                <li>
                  The open chat keeps its shelf until you open another, so reading or replying never
                  moves it.
                </li>
                <li>Archive is one click and wins over the hold. A new message restores it.</li>
                <li>
                  Inbox Only checks Needs Attention, Unread, and Draft, and works with any grouping.
                </li>
              </ul>
            </section>
            <section {...props(styles.note)}>
              <h2 {...props(styles.noteTitle)}>Moving it to the app</h2>
              <ul {...props(styles.list)}>
                <li>
                  <code>inbox.ts</code> joins <code>sidebar-view.ts</code>: export{" "}
                  <code>statusOf</code>, add <code>inbox</code> to <code>GROUPINGS</code> as the
                  default, and list it flat like <code>none</code>.
                </li>
                <li>
                  <code>sidebar.tsx</code> draws the shelves in <code>chatsPanel</code> and keeps
                  the hold beside the pane selection.
                </li>
                <li>The composer restores an archived chat before it sends. Core is unchanged.</li>
              </ul>
            </section>
          </div>
        </div>
      </main>
    </MotionConfig>
  );
}

const styles = create({
  page: {
    height: "100%",
    overflowY: "auto",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 1440,
    marginInline: "auto",
    padding: "48px 32px 96px",
  },
  header: { display: "flex", flexDirection: "column", gap: 4 },
  title: { margin: 0, fontSize: type.font2xl, fontWeight: 600, letterSpacing: type.letterLg },
  lede: { margin: 0, color: role.contentSecondary, fontSize: type.fontBase },
  toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  toolbarLabel: { color: role.contentTertiary, fontSize: type.fontSm },
  toolbarSpacer: { flex: 1 },
  board: {
    display: "grid",
    gridTemplateColumns: "repeat(3, max-content) minmax(240px, 1fr)",
    alignItems: "start",
    gap: 24,
  },
  variant: { display: "flex", flexDirection: "column", gap: 10, width: sidebar.width },
  openColumn: { width: "auto", minWidth: 0 },
  variantHeader: { display: "flex", flexDirection: "column", gap: 2, minHeight: 48 },
  variantName: { margin: 0, fontSize: type.fontBase, fontWeight: 600 },
  variantNote: { margin: 0, fontSize: type.fontSm, color: role.contentTertiary },
  railSlot: { display: "flex", height: 600 },
  open: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  openTitle: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  openGlyph: { display: "grid", placeItems: "center", flexShrink: 0 },
  openTitleText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: type.fontLg,
    fontWeight: 600,
  },
  facts: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: 12,
    rowGap: 4,
    margin: 0,
    fontSize: type.fontSm,
  },
  factTerm: { color: role.contentTertiary },
  factValue: { margin: 0 },
  openNote: { margin: 0, color: role.contentSecondary, fontSize: type.fontSm },
  openActions: { display: "flex", flexWrap: "wrap", gap: 8 },
  notes: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
    gap: 24,
  },
  note: { display: "flex", flexDirection: "column", gap: 8 },
  noteTitle: { margin: 0, fontSize: type.fontBase, fontWeight: 600 },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    margin: 0,
    paddingInlineStart: 20,
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
});
