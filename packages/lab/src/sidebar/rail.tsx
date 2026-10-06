/**
 * The rail's pieces for the lab boards, drawn with the desktop's own sidebar
 * styles so a draft reads at product fidelity. Rows mirror `SessionRow` and
 * `DraftRow` in `packages/app/src/chrome/sidebar.tsx`, minus drag, rename, and
 * the hover preview.
 */
import { create, props } from "@stylexjs/stylex";
import { motion } from "motion/react";
import { useId, useState, type ReactElement, type ReactNode } from "react";
import type { SessionInfo } from "@nyte-ai/protocol";
import { sidebarFilterStyles as filter } from "@nyte-ai/app/chrome/sidebar-filter.stylex.ts";
import {
  sessionIsDraft,
  STATUSES,
  toggleOption,
  type SessionStatus,
} from "@nyte-ai/app/chrome/sidebar-view.ts";
import { sidebarStyles as rail } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { formatTimeAgo, StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { failureNotice } from "@nyte-ai/app/conversation/tool-copy.ts";
import { sessionActivityMark } from "@nyte-ai/app/session-activity.ts";
import { sessionHasUnreadCompletion, type ReadSessions } from "@nyte-ai/app/session-read-state.ts";
import { sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Toggle } from "@nyte-ai/ui/toggle";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import type { ComposerDraft } from "./fixtures";
import { INBOX_STATUSES, isInboxOnly, type RailView } from "./inbox";

export function chatTitle(session: SessionInfo): string {
  return session.name ?? session.preview ?? "New chat";
}

/** What a row that needs you is waiting on: the question asked, or why the run failed. */
export function chatAsk(session: SessionInfo): string | undefined {
  for (const head of session.heads) {
    const run = head.run;

    if (run?.phase.kind === "waiting" && run.awaitingReply === true) return run.question;
  }

  for (const head of session.heads)
    if (head.run?.phase.kind === "failed") return failureNotice(head.run.phase.failure).text;

  return undefined;
}

/** `StatusGlyph`, reading the board's read receipts instead of this window's. */
export function ChatGlyph({
  session,
  read,
}: {
  readonly session: SessionInfo;
  readonly read: ReadSessions;
}): ReactElement | null {
  const mark = sessionActivityMark(session, false);

  if (mark !== "idle") return <StatusDot mark={mark} />;

  if (sessionHasUnreadCompletion(session, read))
    return <Icon name="eye" size={14} label="Unread" />;

  return sessionIsDraft(session) ? <Icon name="draft" size={14} label="Draft" /> : null;
}

/** The rail column itself: the sidebar's material and width, cut to a card. */
export function RailFrame({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <nav aria-label={label} {...props(styles.frame)}>
      {children}
    </nav>
  );
}

/** Hover reveals pin and archive, as today; always shows archive on every row and leaves pin to the menu. */
export type ArchiveButton = "hover" | "always";

export function ChatRow({
  session,
  read,
  scope,
  selected,
  archiveButton,
  onOpen,
  onPin,
  onArchive,
}: {
  readonly session: SessionInfo;
  readonly read: ReadSessions;
  /** Keeps shared-layout ids apart when several rails draw the same chat. */
  readonly scope: string;
  readonly selected: boolean;
  readonly archiveButton: ArchiveButton;
  readonly onOpen: () => void;
  readonly onPin: () => void;
  readonly onArchive: () => void;
}): ReactElement {
  const title = chatTitle(session);
  const mark = sessionActivityMark(session, false);
  const ask = mark === "waiting" || mark === "failed" ? chatAsk(session) : undefined;
  const always = archiveButton === "always";

  const titleLine = (
    <>
      <Row.Label xstyle={always ? rail.draftLabel : rail.sessionLabel}>{title}</Row.Label>
      <Row.Meta xstyle={rail.rowMeta}>{formatTimeAgo(session.lastActivityAt)}</Row.Meta>
    </>
  );

  return (
    <Row
      render={
        <motion.div layout="position" layoutId={`${scope}:${session.sessionId}`} initial={false} />
      }
      selected={selected}
      revealActions={!always}
      xstyle={[
        rail.rowSurface,
        rail.sessionRow,
        selected && rail.rowSelected,
        ask !== undefined && rail.sessionRowAsk,
        always && styles.actionsShown,
      ]}
    >
      {selected && (
        <Row.Backdrop
          xstyle={rail.sessionSelection}
          render={
            <motion.div
              initial={false}
              layout="position"
              layoutId={`${scope}:selected`}
              layoutCrossfade={false}
            />
          }
        />
      )}
      <Row.Primary aria-current={selected ? "page" : undefined} onClick={onOpen}>
        <Row.Leading xstyle={[rail.rowIcon, ask !== undefined && rail.rowIconAsk]}>
          <ChatGlyph session={session} read={read} />
        </Row.Leading>
        {ask === undefined ? (
          titleLine
        ) : (
          <Row.Body>
            <span {...props(rail.sessionTitleLine)}>{titleLine}</span>
            <Row.Description
              xstyle={[mark === "failed" ? intent.danger : intent.warning, rail.sessionAsk]}
            >
              {ask}
            </Row.Description>
          </Row.Body>
        )}
      </Row.Primary>
      <Row.Actions
        placement="overlay"
        xstyle={[rail.rowActionsBesideMeta, ask !== undefined && rail.rowActionsAsk]}
      >
        {!always && (
          <Button
            size="2xs"
            iconOnly
            icon={session.pinned ? "unpin" : "pin"}
            aria-label={`${session.pinned ? "Unpin" : "Pin"} ${title}`}
            onClick={onPin}
          />
        )}
        <Button
          size="2xs"
          iconOnly
          aria-label={`${session.archived ? "Restore" : "Archive"} ${title}`}
          onClick={onArchive}
        >
          <span {...props(rail.actionGlyphArchive)}>
            <Icon name={session.archived ? "unarchive" : "archive"} size={12} />
          </span>
        </Button>
      </Row.Actions>
    </Row>
  );
}

export function ComposerDraftRow({
  draft,
  scope,
  onDelete,
}: {
  readonly draft: ComposerDraft;
  readonly scope: string;
  readonly onDelete: () => void;
}): ReactElement {
  return (
    <Row
      render={<motion.div layout="position" layoutId={`${scope}:${draft.id}`} initial={false} />}
      revealActions
      xstyle={[rail.rowSurface, rail.sessionRow, rail.draftRow]}
    >
      <Row.Primary title={`Draft: ${draft.text}`}>
        <Row.Leading xstyle={rail.rowIcon}>
          <span role="img" aria-label="Draft" {...props(rail.draftDot)} />
        </Row.Leading>
        <Row.Label xstyle={rail.draftLabel}>{draft.text}</Row.Label>
        <Row.Meta xstyle={rail.rowMeta}>{formatTimeAgo(draft.updatedAt)}</Row.Meta>
      </Row.Primary>
      <Row.Actions placement="overlay" xstyle={rail.rowActionsBesideMeta}>
        <Button
          size="2xs"
          iconOnly
          icon="trash"
          aria-label={`Delete Draft: ${draft.text}`}
          onClick={onDelete}
        />
      </Row.Actions>
    </Row>
  );
}

/** A folded group of rows under one header that says how many it holds. */
export function Shelf({
  label,
  count,
  leading,
  defaultOpen = false,
  children,
}: {
  readonly label: string;
  readonly count: number;
  readonly leading: ReactNode;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} xstyle={rail.section}>
      <Collapsible.Trigger
        variant="plain"
        aria-controls={panelId}
        xstyle={[styles.shelf, focus.ringInset]}
      >
        <span {...props(rail.rowIcon, styles.shelfLeading)}>{leading}</span>
        <span {...props(styles.shelfLabel)}>{label}</span>
        <span {...props(styles.shelfCount)}>{count}</span>
        <Collapsible.Chevron xstyle={styles.shelfChevron} />
      </Collapsible.Trigger>
      <Collapsible.Panel id={panelId} hiddenUntilFound={false} xstyle={styles.shelfPanel}>
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

const STATUS_LABELS = {
  "needs-attention": "Needs Attention",
  unread: "Unread",
  working: "Working",
  draft: "Draft",
  done: "Done",
} as const satisfies Readonly<Record<SessionStatus, string>>;

const STATUS_ICONS = {
  "needs-attention": "bell",
  unread: "eye",
  working: undefined,
  draft: "draft",
  done: undefined,
} as const satisfies Readonly<Record<SessionStatus, IconName | undefined>>;

/**
 * `WorkspaceControls`, cut to the parts this draft changes: Inbox joins
 * Grouping as the default, and Inbox Only heads the Status filter.
 */
export function ChatsMenu({
  value,
  onChange,
}: {
  readonly value: RailView;
  readonly onChange: (value: RailView) => void;
}): ReactElement {
  const filtersActive = value.statuses.length > 0 || value.archived;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Toggle
            size="sm"
            iconOnly
            aria-label="Customize Sidebar"
            pressed={filtersActive}
            onPressedChange={() => undefined}
          >
            <Icon name="filters" size={14} />
          </Toggle>
        }
      />
      <MenuContent side="right" align="start" xstyle={filter.popup}>
        <MenuSub>
          <MenuSubTrigger icon="folder">Grouping</MenuSubTrigger>
          <MenuSubContent xstyle={filter.popup}>
            <MenuRadioGroup
              value={value.grouping}
              onValueChange={(grouping) => {
                if (grouping === "inbox" || grouping === "none") onChange({ ...value, grouping });
              }}
            >
              <MenuRadioItem value="inbox" icon="inbox-empty" closeOnClick={false}>
                Inbox
              </MenuRadioItem>
              <MenuRadioItem value="none" icon="list" closeOnClick={false}>
                None
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuSubContent>
        </MenuSub>
        <MenuSeparator />
        <MenuGroup>
          <div {...props(filter.groupHeading)}>
            <MenuGroupLabel xstyle={filter.groupLabel}>Filters</MenuGroupLabel>
            {filtersActive && (
              <MenuItem
                layout="plain"
                closeOnClick={false}
                xstyle={filter.groupAction}
                onClick={() => onChange({ ...value, statuses: [], archived: false })}
              >
                Reset
              </MenuItem>
            )}
          </div>
          <MenuSub>
            <MenuSubTrigger icon="status">Status</MenuSubTrigger>
            <MenuSubContent xstyle={filter.popup}>
              <MenuCheckboxItem
                icon="inbox-empty"
                checked={isInboxOnly(value.statuses)}
                onCheckedChange={(checked) =>
                  onChange({ ...value, statuses: checked ? INBOX_STATUSES : [] })
                }
              >
                Inbox Only
              </MenuCheckboxItem>
              <MenuSeparator />
              {STATUSES.map((status) => (
                <MenuCheckboxItem
                  key={status}
                  icon={STATUS_ICONS[status]}
                  checked={value.statuses.includes(status)}
                  leading={
                    status === "needs-attention" ? (
                      <StatusDot mark="waiting" />
                    ) : status === "working" ? (
                      <StatusDot mark="working" />
                    ) : undefined
                  }
                  onCheckedChange={(checked) =>
                    onChange({
                      ...value,
                      statuses: toggleOption(STATUSES, value.statuses, status, checked),
                    })
                  }
                >
                  {STATUS_LABELS[status]}
                </MenuCheckboxItem>
              ))}
            </MenuSubContent>
          </MenuSub>
          <MenuCheckboxItem
            checked={value.archived}
            icon="archive"
            onCheckedChange={(archived) => onChange({ ...value, archived })}
          >
            Archived
          </MenuCheckboxItem>
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}

const styles = create({
  frame: {
    display: "flex",
    flexDirection: "column",
    width: sidebar.width,
    minHeight: 0,
    flexShrink: 0,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: role.sidebarMaterial,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  /** `Row`'s reveal flag held on, so the label and time make room as they do on hover. */
  actionsShown: {
    "--_row-actions-display": "inline-flex",
    "--_row-actions-opacity": "1",
  },
  shelf: {
    display: "flex",
    alignItems: "center",
    gap: sidebar.rowGap,
    width: "100%",
    minHeight: sidebar.rowHeight,
    paddingInline: sidebar.rowPaddingInline,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    "--_shelf-chevron-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover) and (pointer: fine)": "1" },
      ":focus-visible": "1",
    },
  },
  shelfLeading: { display: "grid", placeItems: "center" },
  shelfLabel: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  shelfCount: {
    color: role.contentTertiary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontVariantNumeric: "tabular-nums",
  },
  shelfChevron: { marginInlineStart: "auto", opacity: "var(--_shelf-chevron-opacity)" },
  shelfPanel: {
    display: { default: "flex", "[hidden]": "none" },
    flexDirection: "column",
    gap: sidebar.listGap,
  },
});
