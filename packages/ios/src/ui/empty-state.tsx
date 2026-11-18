import type { ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { textStyles, useTheme } from "../theme.ts";

export function EmptyState({
  title,
  description,
  systemImage,
  children,
}: {
  title: string;
  description?: string;
  systemImage?: SFSymbol;
  children?: ReactNode;
}) {
  const theme = useTheme();

  return (
    <html.div style={styles.content}>
      {systemImage ? <SymbolView name={systemImage} size={36} tintColor={theme.tertiary} /> : null}
      <html.h2 style={[textStyles.title, styles.centered]}>{title}</html.h2>
      {description ? (
        <html.p style={[textStyles.secondary, styles.centered, styles.description]}>
          {description}
        </html.p>
      ) : null}
      {children}
    </html.div>
  );
}

const styles = css.create({
  content: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    paddingBlock: 48,
  },
  centered: { textAlign: "center" },
  description: { maxWidth: 280 },
});
