import { create, props } from "@stylexjs/stylex";
import { useEffectEvent, useState } from "react";
import type { ReactElement } from "react";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { editable } from "./composer.tsx";
import type { Item, Stack, Status } from "./model.ts";
import { GroupLabel, StepLabel, StepTile, StepTrack, ago, itemNumber } from "./parts.tsx";
import { finished, progress } from "./progress.ts";

const NARROW = "@container stacks (max-width: 639px)";

const styles = create({
  groups: { display: "flex", flexDirection: "column", gap: space.s6 },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    scrollMarginBlockStart: space.s4,
  },
  heading: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    alignSelf: "flex-start",
    paddingInline: space.s1,
    marginInlineStart: `calc(-1 * ${space.s1})`,
    borderRadius: radius.indicator,
    color: { default: role.contentSecondary, ":hover": role.contentPrimary },
  },
  chevron: { color: role.contentTertiary },
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
    borderRadius: radius.card,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    overflow: "hidden",
  },
  rowItem: {
    position: "relative",
    backgroundColor: role.bgBase,
    borderBlockStartWidth: { default: 1, ":first-child": 0 },
    borderBlockStartStyle: "solid",
    borderBlockStartColor: role.borderSecondaryTranslucent,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr) auto",
    columnGap: space.s3,
    rowGap: space.s0_5,
    alignItems: "start",
    width: "100%",
    paddingBlock: space.s2_5,
    paddingInline: space.s3,
    borderWidth: 0,
    backgroundColor: { default: role.bgBase, ":hover": role.bgHover },
    color: role.contentPrimary,
    fontFamily: "inherit",
    textAlign: "start",
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
  },
  rowTile: { gridRow: "1 / 3", paddingBlockStart: space.s0_5 },
  rowFresh: { backgroundColor: { default: role.bgMuted, ":hover": role.bgHover } },
  rowLinked: { backgroundColor: role.bgHover },
  rowCursor: { boxShadow: `inset 2px 0 0 ${role.contentPrimary}` },
  rowName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: { default: "nowrap", [NARROW]: "normal" },
    textWrap: "pretty",
  },
  rowNameDone: { color: role.contentSecondary },
  rowMeta: {
    gridColumn: "2 / 4",
    display: "flex",
    flexWrap: { default: "nowrap", [NARROW]: "wrap" },
    alignItems: "center",
    columnGap: space.s2,
    rowGap: space.s1,
    minWidth: 0,
    color: role.contentTertiary,
  },
  rowStack: { display: "inline-flex", alignItems: "center", gap: space.s1, whiteSpace: "nowrap" },
  sep: { color: role.contentDisabled },
  rowDetail: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    display: { default: "block", [NARROW]: "none" },
  },
  rowAsk: { color: role.contentPrimary, fontWeight: type.weightMedium },
  rowEnd: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    color: role.contentTertiary,
    fontVariantNumeric: "tabular-nums",
  },
  unread: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: role.contentInteractivePrimary,
  },
});

export interface ListGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly Item[];
}

/** What a row needs from outside itself: the other items, the stacks and what you've seen. */
export interface Context {
  readonly all: readonly Item[];
  /** Name the stack on each row; null where the page is one stack already. */
  readonly stacks: readonly Stack[] | null;
  readonly seen: Readonly<Record<string, Status>>;
  readonly clock: number;
}

/**
 * Lanes of rows that fold. A row says where the item is and what it waits on; answering happens
 * on the item, in one place.
 */
export function ItemList({
  groups,
  context,
  cursor,
  fresh,
  linked,
  onOpen,
}: {
  readonly groups: readonly ListGroup[];
  readonly context: Context;
  readonly cursor: string | null;
  readonly fresh: string | null;
  /** The row the briefing points at while you hover its link. */
  readonly linked: string | null;
  readonly onOpen: (item: string) => void;
}): ReactElement {
  return (
    <div {...props(styles.groups)}>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <Collapsible.Root
            key={group.id}
            defaultOpen
            render={<section id={`lane-${group.id}`} aria-label={group.label} />}
            xstyle={styles.group}
          >
            <Collapsible.Trigger variant="plain" xstyle={[styles.heading, focus.ring]}>
              <GroupLabel label={group.label} count={group.items.length} />
              <Collapsible.Chevron xstyle={styles.chevron} />
            </Collapsible.Trigger>
            <Collapsible.Panel>
              <ul {...props(styles.list)}>
                {group.items.map((item) => (
                  <li key={item.id} {...props(styles.rowItem)}>
                    <ItemRow
                      item={item}
                      context={context}
                      fresh={item.id === fresh}
                      cursor={item.id === cursor}
                      linked={item.id === linked}
                      onOpen={() => onOpen(item.id)}
                    />
                  </li>
                ))}
              </ul>
            </Collapsible.Panel>
          </Collapsible.Root>
        ))}
    </div>
  );
}

function ItemRow({
  item,
  context,
  fresh,
  cursor,
  linked,
  onOpen,
}: {
  readonly item: Item;
  readonly context: Context;
  readonly fresh: boolean;
  readonly cursor: boolean;
  readonly linked: boolean;
  readonly onOpen: () => void;
}): ReactElement {
  const step = progress(item);
  const ended = finished(item);
  const number = itemNumber(item);
  const stack = context.stacks?.find((entry) => entry.id === item.stack);
  const blocker = context.all.find((entry) => entry.id === item.after);
  const seen = context.seen[item.id];
  const unread = seen !== undefined && seen !== item.status;
  const asking = item.status === "needs-you" && step.label !== item.now;
  const last = item.activity.at(-1)?.text.replace(/\.$/, "");

  const detail =
    blocker !== undefined
      ? `After ${itemNumber(blocker) ?? `\u201c${blocker.title}\u201d`}`
      : asking
        ? item.now
        : last;

  const separator = (
    <span aria-hidden="true" {...props(styles.sep)}>
      ·
    </span>
  );

  return (
    <button
      type="button"
      onClick={onOpen}
      {...props(
        text.base,
        styles.row,
        focus.ringInset,
        fresh && styles.rowFresh,
        linked && styles.rowLinked,
        cursor && styles.rowCursor,
      )}
    >
      <span {...props(styles.rowTile)}>
        <StepTile progress={step} />
      </span>
      <span {...props(styles.rowName, ended && styles.rowNameDone)}>{item.title}</span>
      <span {...props(text.sm, styles.rowEnd)}>
        {unread && (
          <span aria-label="Changed since you looked" {...props(intent.primary, styles.unread)} />
        )}
        {ago(item.updated, context.clock, true)}
      </span>
      <span {...props(text.sm, styles.rowMeta)}>
        {stack !== undefined && (
          <>
            <span {...props(styles.rowStack)}>
              <Icon name={stack.icon} size={12} />
              {stack.name}
            </span>
            {separator}
          </>
        )}
        {number !== null && (
          <>
            <span>{number}</span>
            {separator}
          </>
        )}
        <StepLabel progress={step} />
        {!ended && <StepTrack progress={step} />}
        {detail !== undefined && (
          <span {...props(styles.rowDetail, asking && styles.rowAsk)}>{detail}</span>
        )}
      </span>
    </button>
  );
}

/** j and k walk `order`, Enter opens; typing in a field is left alone. */
export function useCursor(order: readonly Item[], onOpen: (item: string) => void): string | null {
  const [cursor, setCursor] = useState<string | null>(null);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return;
    const at = order.findIndex((item) => item.id === cursor);

    if (event.key === "j" || event.key === "k") {
      event.preventDefault();

      const next =
        order[Math.max(0, Math.min(order.length - 1, at + (event.key === "j" ? 1 : -1)))];

      if (next !== undefined) setCursor(next.id);

      return;
    }

    if (event.key === "Enter" && cursor !== null) {
      event.preventDefault();
      onOpen(cursor);
    }
  });

  useMountEffect(() => {
    const listener = (event: KeyboardEvent): void => onKey(event);

    window.addEventListener("keydown", listener);

    return () => window.removeEventListener("keydown", listener);
  });

  return cursor;
}
