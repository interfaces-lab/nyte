import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { avatar, glyph, row, shape } from "@nyte-ai/ui/schema.stylex";
/**
 * The Reviews list beside the app sidebar: For me or Created, grouped by
 * what each pull request needs from you, closest to shipping first.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Tabs } from "@nyte-ai/ui/tabs";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";
import { COMPLETED_REVIEWS, OTHER_REVIEWS, type ReviewStatus } from "./scenario";

export type LiveStatus = ReviewStatus | "checks_running" | "checks_failed" | "conflicts" | "merged";

export interface ReviewRow {
  readonly number: number;
  readonly title: string;
  readonly status: LiveStatus;
  readonly author: string;
  readonly age: string;
}

const LABEL: Readonly<Record<LiveStatus, string>> = {
  waiting: "Waiting for your review",
  in_review: "In review",
  changes_requested: "You requested changes",
  approved: "Approved",
  checks_running: "Checks running",
  checks_failed: "Checks failed",
  conflicts: "Conflicts with main",
  merged: "Merged",
};

function StatusMark({ status }: { readonly status: LiveStatus }): ReactElement | null {
  if (status === "in_review") return null;
  if (status === "checks_running") return <Spinner />;
  if (status === "waiting" || status === "approved" || status === "merged")
    return (
      <span {...props(styles.mark, [intent.success, styles.markGood])}>
        <Icon name="checkmark" size={10} />
      </span>
    );

  return (
    <span {...props(styles.mark, [intent.danger, styles.markBad])}>
      <Icon name="x" size={10} />
    </span>
  );
}

function Row({
  row,
  selected,
  onSelect,
}: {
  readonly row: ReviewRow;
  readonly selected: boolean;
  readonly onSelect?: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      disabled={onSelect === undefined}
      onClick={onSelect}
      {...props(styles.row, selected && styles.rowSelected)}
    >
      <span {...props(styles.line)}>
        <span {...props(styles.title)}>{row.title}</span>
        <Icon
          name={row.status === "merged" ? "merged" : "pull-request"}
          size={14}
          xstyle={
            row.status === "merged"
              ? [surfaceTheme.purple, styles.merged]
              : [intent.success, styles.open]
          }
        />
      </span>
      <span {...props(styles.line)}>
        <span {...props(styles.status)}>
          <StatusMark status={row.status} />
          {LABEL[row.status]}
        </span>
        <span {...props(styles.who)}>
          <span {...props(styles.avatar)}>{row.author.slice(0, 1)}</span>
          {row.age}
        </span>
      </span>
    </button>
  );
}

function Group({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  readonly label: string;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children?: ReactElement | readonly ReactElement[];
}): ReactElement {
  return (
    <div {...props(styles.group)}>
      <button type="button" aria-expanded={open} onClick={onToggle} {...props(styles.groupHeader)}>
        <Icon name="pull-request" size={13} />
        <span>{label}</span>
        <span {...props(styles.groupCount)}>{count}</span>
        <span {...props(styles.spacer)} />
        <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
      </button>
      {open && children}
    </div>
  );
}

export function ReviewList({
  current,
  onOpen,
}: {
  readonly current: ReviewRow;
  readonly onOpen: () => void;
}): ReactElement {
  const [tab, setTab] = useState<"for-me" | "created">("for-me");
  const [open, setOpen] = useState({ needs: true, reviewing: true, completed: false });
  const needsYou =
    current.status === "waiting" ||
    current.status === "checks_running" ||
    current.status === "checks_failed" ||
    current.status === "conflicts";
  const others = (group: "needs" | "reviewing"): readonly ReviewRow[] =>
    OTHER_REVIEWS.filter((row) => row.group === group);
  const needs = [...(needsYou ? [current] : []), ...others("needs")];
  const reviewing = [...(current.status === "approved" ? [current] : []), ...others("reviewing")];
  const toggle = (key: keyof typeof open): void => setOpen({ ...open, [key]: !open[key] });

  return (
    <aside aria-label="Reviews" {...props(styles.pane)}>
      <div {...props(styles.head)}>
        <span {...props(styles.heading)}>Reviews</span>
        <Tabs.Root
          variant="pill"
          value={tab}
          onValueChange={(next: unknown) => setTab(next === "created" ? "created" : "for-me")}
        >
          <Tabs.List aria-label="Reviews">
            <Tabs.Tab value="for-me">For me</Tabs.Tab>
            <Tabs.Tab value="created">Created</Tabs.Tab>
          </Tabs.List>
        </Tabs.Root>
      </div>
      <div {...props(styles.scroll)}>
        {tab === "created" ? (
          <p {...props(styles.empty)}>Pull requests you open appear here.</p>
        ) : (
          <>
            <Group
              label="Needs your review"
              count={needs.length}
              open={open.needs}
              onToggle={() => toggle("needs")}
            >
              {needs.map((row) => (
                <Row
                  key={row.number}
                  row={row}
                  selected={row === current}
                  onSelect={row === current ? onOpen : undefined}
                />
              ))}
            </Group>
            <Group
              label="You're reviewing"
              count={reviewing.length}
              open={open.reviewing}
              onToggle={() => toggle("reviewing")}
            >
              {reviewing.map((row) => (
                <Row
                  key={row.number}
                  row={row}
                  selected={row === current}
                  onSelect={row === current ? onOpen : undefined}
                />
              ))}
            </Group>
            <Group
              label="Completed"
              count={COMPLETED_REVIEWS + (current.status === "merged" ? 1 : 0)}
              open={open.completed}
              onToggle={() => toggle("completed")}
            >
              {current.status === "merged"
                ? [<Row key={current.number} row={current} selected onSelect={onOpen} />]
                : []}
            </Group>
          </>
        )}
      </div>
    </aside>
  );
}

const styles = create({
  pane: {
    display: "flex",
    flexDirection: "column",
    width: 320,
    flexShrink: 0,
    minHeight: 0,
    backgroundColor: role.bgBase,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: role.borderSecondaryTranslucent,
  },
  head: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    paddingInline: 12,
    paddingBlock: "12px 8px",
  },
  heading: { color: role.contentPrimary, fontWeight: 600 },
  scroll: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: 8,
  },
  empty: { margin: 0, padding: 8, color: role.contentSecondary, fontSize: type.fontSm },
  group: { display: "flex", flexDirection: "column", gap: 2 },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: row.heightMd,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: shape.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    font: "inherit",
    fontSize: type.fontSm,
    cursor: appearance.cursorInteractive,
  },
  groupCount: { color: role.contentSecondary, fontVariantNumeric: "tabular-nums" },
  spacer: { flex: 1 },
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingBlock: 8,
    paddingInline: 10,
    borderStyle: "none",
    borderRadius: shape.control,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": role.bgHover },
    color: role.contentPrimary,
    font: "inherit",
    textAlign: "start",
    cursor: { default: appearance.cursorInteractive, ":disabled": "default" },
  },
  rowSelected: {
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderPrimary}`,
  },
  line: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  open: { color: role.contentInteractiveTertiary, flexShrink: 0 },
  merged: { color: role.contentInteractiveTertiary, flexShrink: 0 },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    whiteSpace: "nowrap",
  },
  mark: {
    display: "inline-grid",
    placeItems: "center",
    width: glyph.md,
    height: glyph.md,
    borderRadius: shape.indicator,
    flexShrink: 0,
  },
  markGood: {
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    color: role.contentSecondary,
  },
  markBad: {
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    color: role.contentSecondary,
  },
  who: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    flexShrink: 0,
  },
  avatar: {
    display: "inline-grid",
    placeItems: "center",
    width: avatar.xs,
    height: avatar.xs,
    borderRadius: shape.pill,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    color: role.contentSecondary,
    fontSize: 9,
    fontWeight: 600,
  },
});
