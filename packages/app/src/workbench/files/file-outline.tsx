import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { Row } from "@nyte-ai/ui/row";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { preferences, useSetting } from "../../preferences/index.ts";
import type { OutlineSymbol } from "./outline.ts";

/** The open file's symbols under the tree. */
export function FileOutline({
  symbols,
  empty,
  onOpen,
}: {
  readonly symbols: readonly OutlineSymbol[];
  readonly empty: string;
  readonly onOpen: (line: number) => void;
}): ReactElement {
  const open = useSetting(preferences.fileOutline);

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={preferences.fileOutline.set}
      {...props(hairline.blockStart, styles.root, open && styles.open)}
    >
      <Collapsible.Trigger xstyle={styles.trigger}>
        <Collapsible.Chevron />
        Outline
      </Collapsible.Trigger>
      <Collapsible.Panel xstyle={styles.panel}>
        {symbols.length === 0 ? (
          <p {...props(styles.empty)}>{empty}</p>
        ) : (
          <ul aria-label="Outline" {...props(styles.list)}>
            {symbols.map((symbol) => (
              <li key={`${String(symbol.line)}:${symbol.name}`}>
                <Row
                  variant="nav"
                  title={`${symbol.kind}, line ${String(symbol.line)}`}
                  xstyle={styles.row(symbol.depth)}
                  onClick={() => onOpen(symbol.line)}
                >
                  <Row.Label>{symbol.name}</Row.Label>
                  <Row.Meta>{symbol.line}</Row.Meta>
                </Row>
              </li>
            ))}
          </ul>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

const styles = create({
  root: { display: "flex", flexDirection: "column", flexShrink: 0, minHeight: 0 },
  open: { flexBasis: "34%" },
  trigger: { flexShrink: 0, paddingInline: space.s2_5, color: role.contentSecondary },
  panel: { flex: 1, minHeight: 0, overflowY: "auto" },
  list: { margin: 0, padding: space.s1, listStyle: "none" },
  row: (depth: number) => ({
    paddingInlineStart: `calc(${space.s2} + ${String(Math.min(depth, 6) * 12)}px)`,
  }),
  empty: {
    margin: 0,
    paddingInline: space.s2_5,
    paddingBlock: space.s2,
    color: role.contentTertiary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
});
