import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Avatar, AvatarFallback } from "@nyte-ai/ui/avatar";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { GROUPS, MODELS } from "./model.ts";
import type { Item } from "./model.ts";
import { CheckDots, GroupLabel, Meta, StatusGlyph, Tile, ago, checkSummary } from "./parts.tsx";

const COMPACT = "@container stacks (max-width: 959px)";

const NARROW = "@container stacks (max-width: 639px)";

const styles = create({
  board: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(4, minmax(220px, 1fr))",
      [NARROW]: "repeat(4, minmax(240px, 82%))",
    },
    gap: space.s3,
    overflowX: "auto",
    scrollSnapType: { default: "none", [COMPACT]: "x mandatory" },
    scrollPaddingInline: space.s4,
    marginInline: { default: 0, [NARROW]: `calc(-1 * ${space.s4})` },
    paddingInline: { default: 0, [NARROW]: space.s4 },
    paddingBlockEnd: space.s2,
  },
  column: {
    scrollSnapAlign: "start",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    minWidth: 0,
    padding: space.s2,
    borderRadius: radius.surface,
    backgroundColor: role.bgMuted,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingInline: space.s2,
    paddingBlock: space.s1,
  },
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    width: "100%",
    padding: space.s3,
    borderWidth: 0,
    borderRadius: radius.card,
    backgroundColor: role.bgBase,
    boxShadow: {
      default: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
      ":hover": shadow.shadowMdOutline,
    },
    color: role.contentPrimary,
    fontFamily: "inherit",
    textAlign: "start",
    cursor: "pointer",
    transitionProperty: "box-shadow",
    transitionDuration: motion.durationFast,
  },
  cardCursor: { boxShadow: `0 0 0 1px ${role.borderStrong}` },
  cardFresh: { boxShadow: `0 0 0 1px ${role.borderStrong}, ${shadow.shadowMdOutline}` },
  cardDone: { color: role.contentSecondary },
  top: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: role.contentTertiary,
  },
  number: { fontVariantNumeric: "tabular-nums" },
  title: { display: "flex", alignItems: "flex-start", gap: space.s2 },
  name: { fontWeight: type.weightMedium, textWrap: "pretty", minWidth: 0 },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s1,
  },
  ask: { color: role.contentPrimary, fontWeight: type.weightMedium },
  empty: { paddingInline: space.s2, paddingBlock: space.s3, color: role.contentTertiary },
});

/** The same items as the list, one column per group. */
export function Board({
  items,
  clock,
  cursor,
  fresh,
  onOpen,
}: {
  readonly items: readonly Item[];
  readonly clock: number;
  readonly cursor: string | null;
  readonly fresh: string | null;
  readonly onOpen: (item: string) => void;
}): ReactElement {
  return (
    <div {...props(styles.board)}>
      {GROUPS.map((group) => {
        const members = items.filter((item) => group.statuses.includes(item.status));

        return (
          <section key={group.id} aria-label={group.label} {...props(styles.column)}>
            <span {...props(styles.head)}>
              <GroupLabel label={group.label} count={members.length} />
            </span>
            {members.length === 0 ? (
              <span {...props(text.sm, styles.empty)}>Nothing</span>
            ) : (
              <ul {...props(styles.cards)}>
                {members.map((item) => {
                  const finished = item.status === "merged" || item.status === "done";

                  const crew = item.sessions
                    .map((session) => MODELS[session.model].short)
                    .join(" → ");

                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(item.id)}
                        {...props(
                          text.base,
                          styles.card,
                          focus.ring,
                          item.id === cursor && styles.cardCursor,
                          item.id === fresh && styles.cardFresh,
                          finished && styles.cardDone,
                        )}
                      >
                        <span {...props(text.sm, styles.top)}>
                          <span {...props(styles.number)}>
                            {item.number === null
                              ? "No pull request yet"
                              : `#${String(item.number)}`}
                          </span>
                          <Avatar size="xs" tone={item.author.tone}>
                            <AvatarFallback>{item.author.initials}</AvatarFallback>
                          </Avatar>
                        </span>
                        <span {...props(styles.title)}>
                          <Tile surface={item.surface} size="sm" />
                          <span {...props(styles.name)}>{item.title}</span>
                        </span>
                        <span {...props(styles.meta)}>
                          <Meta icon={<StatusGlyph status={item.status} />}>
                            <span {...props(item.status === "needs-you" && styles.ask)}>
                              {item.now}
                            </span>
                          </Meta>
                          {item.checks.length > 0 && !finished && (
                            <Meta icon={<CheckDots checks={item.checks} />}>
                              {checkSummary(item.checks)}
                            </Meta>
                          )}
                          {crew !== "" && !finished && <Meta icon={null}>{crew}</Meta>}
                          <Meta icon={null}>{ago(item.updated, clock, true)}</Meta>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
