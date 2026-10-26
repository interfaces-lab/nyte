import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Avatar, AvatarFallback } from "@nyte-ai/ui/avatar";
import { Icon } from "@nyte-ai/ui/icon";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { Item } from "./model.ts";
import { CheckDots, GroupLabel, Meta, StatusGlyph, Tile, ago, checkSummary } from "./parts.tsx";
import { pane } from "./stack-view.tsx";

const NARROW = "@container stacks (max-width: 639px)";

const styles = create({
  groups: { display: "flex", flexDirection: "column", gap: space.s6 },
  group: { display: "flex", flexDirection: "column", gap: space.s2 },
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
    rowGap: space.s1,
    alignItems: "center",
    width: "100%",
    paddingBlock: space.s3,
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
  rowFresh: { backgroundColor: { default: role.bgMuted, ":hover": role.bgHover } },
  rowCursor: { boxShadow: `inset 2px 0 0 ${role.contentPrimary}` },
  rowDone: { color: role.contentSecondary },
  rowTitle: { display: "flex", alignItems: "baseline", gap: space.s2, minWidth: 0 },
  rowName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: { default: "nowrap", [NARROW]: "normal" },
    textWrap: "pretty",
    fontWeight: type.weightMedium,
  },
  rowMeta: {
    gridColumn: "2 / 4",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: { default: space.s4, [NARROW]: space.s3 },
    rowGap: space.s1,
    minWidth: 0,
  },
  rowNow: { color: role.contentSecondary },
  rowAsk: { color: role.contentPrimary, fontWeight: type.weightMedium },
  rowEnd: { display: "flex", alignItems: "center", gap: space.s2, color: role.contentTertiary },
});

export interface ListGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly Item[];
}

/** Groups of rows. A row says what it waits on; answering happens on the item, in one place. */
export function ItemList({
  groups,
  clock,
  cursor,
  fresh,
  onOpen,
}: {
  readonly groups: readonly ListGroup[];
  readonly clock: number;
  readonly cursor: string | null;
  readonly fresh: string | null;
  readonly onOpen: (item: string) => void;
}): ReactElement {
  return (
    <div {...props(styles.groups)}>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.id} aria-label={group.label} {...props(styles.group)}>
            <GroupLabel label={group.label} count={group.items.length} />
            <ul {...props(styles.list)}>
              {group.items.map((item) => (
                <li key={item.id} {...props(styles.rowItem)}>
                  <ItemRow
                    item={item}
                    clock={clock}
                    fresh={item.id === fresh}
                    cursor={item.id === cursor}
                    onOpen={() => onOpen(item.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function ItemRow({
  item,
  clock,
  fresh,
  cursor,
  onOpen,
}: {
  readonly item: Item;
  readonly clock: number;
  readonly fresh: boolean;
  readonly cursor: boolean;
  readonly onOpen: () => void;
}): ReactElement {
  const working = item.sessions.filter((session) => !session.lead);

  const crew = (working.length === 0 ? item.sessions : working)
    .map((session) => session.name)
    .join(" → ");

  const finished = item.status === "merged" || item.status === "done";

  return (
    <button
      type="button"
      onClick={onOpen}
      {...props(
        text.base,
        styles.row,
        focus.ringInset,
        fresh && styles.rowFresh,
        cursor && styles.rowCursor,
        finished && styles.rowDone,
      )}
    >
      <Tile surface={item.surface} size="sm" />
      <span {...props(styles.rowTitle)}>
        {item.number !== null && <span {...props(pane.number)}>#{item.number}</span>}
        <span {...props(styles.rowName)}>{item.title}</span>
      </span>
      <span {...props(text.sm, styles.rowEnd)}>
        <Avatar size="xs" tone={item.author.tone}>
          <AvatarFallback>{item.author.initials}</AvatarFallback>
        </Avatar>
        {ago(item.updated, clock, true)}
      </span>
      <span {...props(styles.rowMeta)}>
        <Meta icon={<StatusGlyph status={item.status} />}>
          <span {...props(item.status === "needs-you" ? styles.rowAsk : styles.rowNow)}>
            {item.now}
          </span>
        </Meta>
        {item.checks.length > 0 && !finished && (
          <Meta icon={<CheckDots checks={item.checks} />}>{checkSummary(item.checks)}</Meta>
        )}
        {crew !== "" && !finished && <Meta icon={<Icon name="agent" size={12} />}>{crew}</Meta>}
      </span>
    </button>
  );
}
