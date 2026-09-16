import { Children, Fragment, type ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { SymbolView } from "expo-symbols";
import { controls, list, radii, spacing, tokens, useTheme } from "../theme.ts";

// The chevron is chrome rather than content, so it takes the tertiary grey of
// whichever appearance is active.

/**
 * A rounded surface card holding rows. The card draws the hairlines between its
 * rows, so a row never carries the separator's inset into its own content.
 * The surface alone separates the card from the page: a border and a shadow on
 * top of it would state the same edge three times.
 */
export function Group({
  children,
  separator = "tile",
}: {
  children: ReactNode;
  /** Where the hairlines start: under the leading tile, or under the label. */
  separator?: "tile" | "label";
}) {
  return (
    <html.div style={styles.group}>
      {Children.toArray(children).map((child, index) => (
        <Fragment key={index}>
          {index === 0 ? null : (
            <html.div
              style={[styles.separator, separator === "tile" ? styles.pastTile : styles.pastLabel]}
            />
          )}
          {child}
        </Fragment>
      ))}
    </html.div>
  );
}

export function GroupRow({
  children,
  onClick,
  disabled = false,
  align = "start",
  pushes = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  align?: "start" | "center";
  /** Opens another screen, so the row carries the disclosure chevron. */
  pushes?: boolean;
}) {
  const theme = useTheme();
  const style = [styles.row, align === "center" && styles.centered, disabled && styles.disabled];
  const content = (
    <>
      {children}
      {pushes ? (
        <html.div style={styles.chevron}>
          <SymbolView
            name="chevron.right"
            size={controls.iconXs}
            weight="semibold"
            tintColor={theme.tertiary}
          />
        </html.div>
      ) : null}
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
});
