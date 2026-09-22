import { Children, createContext, Fragment, use, type ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { SymbolView } from "expo-symbols";
import { controls, list, radii, spacing, tokens, useTheme } from "../theme.ts";

// The chevron and outbound arrow are chrome rather than content, so they take
// the tertiary grey of whichever appearance is active.
const flat = createContext(false);

/**
 * Rows stacked under a section header. The default card draws a rounded surface
 * behind its rows; `flat` rows sit on the page itself, the way the desktop
 * client's account page does, and their hairlines start under the label. The
 * card draws the hairlines between its rows, so a row never carries the
 * separator's inset into its own content.
 */
export function Group({
  children,
  separator = "tile",
  variant = "card",
}: {
  children: ReactNode;
  /** Where the hairlines start: under the leading tile, or under the label. */
  separator?: "tile" | "label";
  /** `flat` drops the card surface and pads rows to the page gutter. */
  variant?: "card" | "flat";
}) {
  const isFlat = variant === "flat";

  return (
    <flat.Provider value={isFlat}>
      <html.div style={[styles.group, isFlat && styles.flatGroup]}>
        {Children.toArray(children).map((child, index) => (
          <Fragment key={index}>
            {index === 0 ? null : (
              <html.div
                style={[
                  styles.separator,
                  isFlat
                    ? styles.pastRing
                    : separator === "tile"
                      ? styles.pastTile
                      : styles.pastLabel,
                ]}
              />
            )}
            {child}
          </Fragment>
        ))}
      </html.div>
    </flat.Provider>
  );
}

const trails = {
  push: "chevron.right",
  link: "arrow.up.right",
} as const;

export function GroupRow({
  children,
  onClick,
  disabled = false,
  align = "start",
  trail,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  align?: "start" | "center";
  /** push = the row opens another screen; link = it leaves the app. */
  trail?: keyof typeof trails;
}) {
  const theme = useTheme();
  const isFlat = use(flat);

  const style = [
    styles.row,
    isFlat && styles.flatRow,
    align === "center" && styles.centered,
    disabled && styles.disabled,
  ];

  const content = (
    <>
      {children}
      {trail === undefined ? null : (
        <html.div style={styles.chevron}>
          <SymbolView
            name={trails[trail]}
            size={controls.iconXs}
            weight="semibold"
            tintColor={theme.tertiary}
          />
        </html.div>
      )}
    </>
  );

  if (onClick !== undefined) {
    return (
      <html.button onClick={onClick} disabled={disabled} aria-disabled={disabled} style={style}>
        {content}
      </html.button>
    );
  }

  return <html.div style={style}>{content}</html.div>;
}

const styles = css.create({
  group: {
    display: "flex",
    flexDirection: "column",
    marginInline: list.gutter,
    backgroundColor: tokens.surface,
    borderRadius: radii.card,
    overflow: "hidden",
  },
  flatGroup: {
    marginInline: 0,
    backgroundColor: "transparent",
    borderRadius: 0,
    overflow: "visible",
  },
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    minHeight: controls.touchTarget,
    paddingInline: spacing.md,
    paddingBlock: 10,
    gap: spacing.md,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
    fontFamily: "inherit",
    fontSize: "inherit",
  },
  flatRow: { paddingInline: list.gutter },
  centered: { justifyContent: "center" },
  chevron: { display: "flex", alignItems: "center", flexShrink: 0, marginInlineStart: "auto" },
  disabled: { opacity: controls.disabledOpacity },
  // Inset to the content column, so the hairline starts under the text.
  separator: {
    height: controls.hairline,
    backgroundColor: tokens.separator,
  },
  pastTile: { marginInlineStart: spacing.md + list.tile + spacing.md },
  pastLabel: { marginInlineStart: spacing.md },
  pastRing: { marginInlineStart: list.gutter + list.ring + spacing.md },
});
