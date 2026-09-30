/**
 * The Reviews list beside the app sidebar: For me or Created, grouped by
 * what each pull request needs from you, closest to shipping first.
 */
import * as stylex from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Tabs } from "@nyte-ai/ui/tabs";
import { ramp, t } from "@nyte-ai/ui/vars.stylex";
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
      <span {...stylex.props(styles.mark, styles.markGood)}>
        <Icon name="checkmark" size={10} />
      </span>
    );

  return (
    <span {...stylex.props(styles.mark, styles.markBad)}>
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
      {...stylex.props(styles.row, selected && styles.rowSelected)}
    >
      <span {...stylex.props(styles.line)}>
        <span {...stylex.props(styles.title)}>{row.title}</span>
        <Icon
          name={row.status === "merged" ? "merged" : "pull-request"}
          size={14}
          xstyle={row.status === "merged" ? styles.merged : styles.open}
        />
      </span>
      <span {...stylex.props(styles.line)}>
        <span {...stylex.props(styles.status)}>
          <StatusMark status={row.status} />
          {LABEL[row.status]}
        </span>
        <span {...stylex.props(styles.who)}>
          <span {...stylex.props(styles.avatar)}>{row.author.slice(0, 1)}</span>
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
    <div {...stylex.props(styles.group)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        {...stylex.props(styles.groupHeader)}
      >
        <Icon name="pull-request" size={13} />
        <span>{label}</span>
        <span {...stylex.props(styles.groupCount)}>{count}</span>
        <span {...stylex.props(styles.spacer)} />
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
    <aside aria-label="Reviews" {...stylex.props(styles.pane)}>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.heading)}>Reviews</span>
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
      <div {...stylex.props(styles.scroll)}>
        {tab === "created" ? (
          <p {...stylex.props(styles.empty)}>Pull requests you open appear here.</p>
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

const styles = stylex.create({
  pane: {
    display: "flex",
    flexDirection: "column",
    width: 320,
    flexShrink: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: t.borderSecondaryTranslucent,
  },
  head: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    paddingInline: 12,
    paddingBlock: "12px 8px",
  },
  heading: { color: t.contentPrimary, fontWeight: 600 },
  scroll: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: 8,
  },
  empty: { margin: 0, padding: 8, color: t.contentSecondary, fontSize: t.fontSm },
  group: { display: "flex", flexDirection: "column", gap: 2 },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: t.radius8,
    backgroundColor: t.bgMutedTranslucent,
    color: t.contentSecondary,
    font: "inherit",
    fontSize: t.fontSm,
    cursor: t.cursorInteractive,
  },
  groupCount: { color: t.contentSecondary, fontVariantNumeric: "tabular-nums" },
  spacer: { flex: 1 },
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingBlock: 8,
    paddingInline: 10,
    borderStyle: "none",
    borderRadius: t.radius8,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": t.bgHover },
    color: t.contentPrimary,
    font: "inherit",
    textAlign: "start",
    cursor: { default: t.cursorInteractive, ":disabled": "default" },
  },
  rowSelected: {
    backgroundColor: t.bgInteractiveSecondaryTranslucent,
    boxShadow: `inset 0 0 0 1px ${t.borderPrimary}`,
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
  open: { color: ramp.green80, flexShrink: 0 },
  merged: { color: ramp.purple80, flexShrink: 0 },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
    color: t.contentSecondary,
    fontSize: t.fontSm,
    whiteSpace: "nowrap",
  },
  mark: {
    display: "inline-grid",
    placeItems: "center",
    width: 16,
    height: 16,
    borderRadius: t.radius4,
    flexShrink: 0,
  },
  markGood: { backgroundColor: t.intentSuccessBg, color: t.intentSuccessContent },
  markBad: { backgroundColor: t.intentDangerBg, color: t.intentDangerContent },
  who: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: t.contentSecondary,
    fontSize: t.fontSm,
    flexShrink: 0,
  },
  avatar: {
    display: "inline-grid",
    placeItems: "center",
    width: 16,
    height: 16,
    borderRadius: t.radiusFull,
    backgroundColor: t.bgInteractivePrimaryTranslucent,
    color: t.contentSecondary,
    fontSize: 9,
    fontWeight: 600,
  },
});
