/**
 * The filter cards at the top of the list: one per way of triaging, each with
 * its own count. Counts come from the loaded page, so a card never claims work
 * the list cannot show.
 */
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { radii, spacing, textStyles, tokens } from "../theme.ts";

type FilterCard<Filter extends string> = {
  readonly id: Filter;
  readonly label: string;
  readonly icon: SFSymbol;
  readonly tint: string;
  readonly count?: number;
};

export function FilterGrid<Filter extends string>({
  cards,
  active,
  onSelect,
}: {
  cards: readonly FilterCard<Filter>[];
  active: Filter;
  onSelect: (filter: Filter) => void;
}) {
  const rows = cards.reduce<FilterCard<Filter>[][]>((acc, card, index) => {
    if (index % 2 === 0) acc.push([card]);
    else acc[acc.length - 1]?.push(card);

    return acc;
  }, []);

  return (
    <html.div style={styles.grid}>
      {rows.map((row, index) => (
        <html.div key={index} style={styles.row}>
          {row.map((card) => (
            <html.button
              key={card.id}
              aria-label={
                card.count === undefined ? card.label : `${card.label}, ${String(card.count)}`
              }
              aria-pressed={card.id === active}
              onClick={() => onSelect(card.id)}
              style={[styles.card, card.id === active && styles.cardActive]}
            >
              <SymbolView name={card.icon} size={22} tintColor={card.tint} />
              <html.div style={styles.caption}>
                <html.span style={[textStyles.body, styles.label]}>{card.label}</html.span>
                {card.count === undefined ? null : (
                  <html.span style={[textStyles.body, styles.count]}>
                    {String(card.count)}
                  </html.span>
                )}
              </html.div>
            </html.button>
          ))}
        </html.div>
      ))}
    </html.div>
  );
}

const styles = css.create({
  grid: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    paddingInline: spacing.gutter,
    paddingBottom: spacing.md,
  },
  row: { display: "flex", flexDirection: "row", gap: spacing.sm },
  card: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: spacing.lg,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    padding: spacing.md,
    borderRadius: radii.control,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
  cardActive: { backgroundColor: tokens.fill, borderColor: tokens.foreground },
  caption: { display: "flex", flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
  label: { color: tokens.foreground },
  count: { color: tokens.muted },
});
