import { Children, Fragment, type ReactNode } from "react";
import { Pressable } from "react-native";
import { Link, type Href } from "expo-router";
import { css, html } from "react-strict-dom";
import { SymbolView } from "expo-symbols";
import { controls, list, radii, spacing, tokens, useTheme } from "../theme.ts";

export function Group({ children }: { children: ReactNode }) {
  return (
    <html.div style={styles.group}>
      {Children.toArray(children).map((child, index) => (
        <Fragment key={index}>
          {index === 0 ? null : <html.div style={styles.separator} />}
          {child}
        </Fragment>
      ))}
    </html.div>
  );
}

const trails = {
  push: "chevron.right",
  link: "arrow.up.right",
} as const;

export function GroupRow({
  children,
  onClick,
  href,
  busy = false,
  role,
  checked,
  disabled = false,
  align = "start",
  trail,
}: {
  children: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  align?: "start" | "center";
} & (
  | { href: Href; onClick?: never; trail?: keyof typeof trails; role?: never; checked?: never }
  | { href?: never; onClick?: () => void; trail?: "link"; role?: "switch"; checked?: boolean }
)) {
  const theme = useTheme();
  const style = [styles.row, align === "center" && styles.centered, disabled && styles.disabled];

  const content = (
    <>
      {children}
      {trail === undefined ? null : (
        <html.div style={styles.chevron}>
          <SymbolView
            name={trails[trail]}
            size={controls.iconXs}
            weight="semibold"
            tintColor={theme.interactiveTertiary}
          />
        </html.div>
      )}
    </>
  );

  if (href !== undefined) {
    return (
      <Link
        href={href}
        asChild
        onPress={(event) => {
          if (disabled || busy) event.preventDefault();
        }}
      >
        <Pressable accessibilityRole="link" accessibilityState={{ disabled, busy }}>
          <html.div style={style}>{content}</html.div>
        </Pressable>
      </Link>
    );
  }

  if (onClick !== undefined) {
    return (
      <html.button
        onClick={() => {
          if (!busy) onClick();
        }}
        role={role}
        aria-checked={checked}
        disabled={disabled}
        aria-disabled={disabled}
        aria-busy={busy}
        style={style}
      >
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
    minHeight: controls.fillHeight - spacing.md * 2,
    paddingInline: spacing.lg,
    paddingBlock: spacing.md,
    gap: spacing.md,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
    fontFamily: "inherit",
    fontSize: "inherit",
  },
  centered: { justifyContent: "center" },
  chevron: { display: "flex", alignItems: "center", flexShrink: 0, marginInlineStart: "auto" },
  disabled: { opacity: controls.disabledOpacity },
  separator: {
    height: controls.hairline,
    backgroundColor: tokens.separator,
    marginInlineStart: spacing.lg + list.tile + spacing.md,
    marginInlineEnd: spacing.lg,
  },
});
