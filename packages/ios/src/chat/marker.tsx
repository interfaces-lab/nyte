import type { ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { conversation, textStyles } from "../theme.ts";

export function Marker({ children }: { children: ReactNode }) {
  return <html.p style={[textStyles.secondary, styles.marker]}>{children}</html.p>;
}

const styles = css.create({
  marker: { paddingInline: conversation.textInset, paddingBlock: 6 },
});
