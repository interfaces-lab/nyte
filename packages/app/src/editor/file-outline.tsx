import { useVirtualizer } from "@tanstack/react-virtual";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { Row } from "@nyte-ai/ui/row";
import { Tooltip, TooltipTrigger, TooltipContent } from "@nyte-ai/ui/tooltip";
import { row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { preferences, useSetting } from "../preferences/index.ts";
import type { OutlineSymbol } from "./outline.ts";
import { SymbolKindGlyph } from "./symbol-kind.tsx";
import { resolveHeight } from "./tree-theme.ts";

const OVERSCAN = 8;

export function FileOutline({
  path,
  symbols,
  empty,
  onOpen,
}: {
  readonly path: string | undefined;
  readonly symbols: readonly OutlineSymbol[];
  readonly empty: string;
  readonly onOpen: (line: number) => void;
}): ReactElement {
  const open = useSetting(preferences.fileOutline);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [rowHeight] = useState(() => resolveHeight(row.heightMd));

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={preferences.fileOutline.set}
      {...props(hairline.blockStart, styles.root, open && styles.open)}
    >
      <Tooltip>
        <TooltipTrigger render={<Collapsible.Trigger xstyle={styles.trigger} />}>
          <Collapsible.Chevron />
          Outline
          {path !== undefined && (
            <span {...props(styles.filename)}>{path.slice(path.lastIndexOf("/") + 1)}</span>
          )}
        </TooltipTrigger>
        {path !== undefined && <TooltipContent>{path}</TooltipContent>}
      </Tooltip>
      <Collapsible.Panel ref={setViewport} xstyle={styles.panel}>
        {symbols.length === 0 ? (
          <p {...props(styles.empty)}>{empty}</p>
        ) : (
          <OutlineRows
            viewport={viewport}
            rowHeight={rowHeight}
            symbols={symbols}
            onOpen={onOpen}
          />
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function OutlineRows({
  viewport,
  rowHeight,
  symbols,
  onOpen,
}: {
  readonly viewport: HTMLDivElement | null;
  readonly rowHeight: number;
  readonly symbols: readonly OutlineSymbol[];
  readonly onOpen: (line: number) => void;
}): ReactElement {
  // oxlint-disable-next-line react/incompatible-library -- the bailout is the intended behaviour
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: symbols.length,
    getScrollElement: () => viewport,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  });

  return (
    <ul aria-label="Outline" {...props(styles.list, styles.height(virtualizer.getTotalSize()))}>
      {virtualizer.getVirtualItems().flatMap((item) => {
        const symbol = symbols[item.index];

        if (symbol === undefined) return [];

        return [
          <li
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            aria-setsize={symbols.length}
            aria-posinset={item.index + 1}
            {...props(styles.item, styles.offset(item.start))}
          >
            <Row
              variant="nav"
              aria-label={`${symbol.name}, ${symbol.kind}, line ${String(symbol.line)}`}
              xstyle={styles.row(symbol.depth)}
              onClick={() => onOpen(symbol.line)}
            >
              <Row.Leading>
                <SymbolKindGlyph kind={symbol.kind} />
              </Row.Leading>
              <Row.Label>{symbol.name}</Row.Label>
              <Row.Meta>{symbol.line}</Row.Meta>
            </Row>
          </li>,
        ];
      })}
    </ul>
  );
}

const styles = create({
  root: { display: "flex", flexDirection: "column", flexShrink: 0, minHeight: 0 },
  open: { flexBasis: "34%" },
  trigger: {
    flexShrink: 0,
    paddingInline: space.s2_5,
    color: role.contentSecondary,
    fontWeight: type.weightMedium,
  },
  filename: {
    marginInlineStart: "auto",
    color: role.contentTertiary,
    fontWeight: type.weightRegular,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  panel: { flex: 1, minHeight: 0, overflowY: "auto" },
  list: { position: "relative", margin: 0, padding: space.s1, listStyle: "none" },
  height: (pixels: number) => ({ height: pixels }),
  item: { position: "absolute", insetBlockStart: space.s1, insetInline: space.s1 },
  offset: (pixels: number) => ({ transform: `translateY(${String(pixels)}px)` }),
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
