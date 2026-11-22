import { useVirtualizer } from "@tanstack/react-virtual";
import { create, props } from "@stylexjs/stylex";
import { useLayoutEffect, useState } from "react";
import type { ReactElement, SyntheticEvent } from "react";
import type { CompletionItem } from "@nyte-ai/schema";
import { MENU_COLLISION } from "@nyte-ai/ui/menu";
import { Popover } from "@nyte-ai/ui/popover";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { menu, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { SelectedWorkspace } from "../../contract/bridge.ts";
import { ChatScope } from "../../chat/chat-scope.tsx";
import { Prose } from "../../chat/markdown/prose.tsx";
import type { RankedCompletion } from "./completion.ts";
import { SymbolKindGlyph } from "./symbol-kind.tsx";
import { resolveHeight } from "./tree-theme.ts";
import type { CompletionPopup } from "./use-completion.ts";

const VISIBLE_ROWS = 12;

const OVERSCAN = 8;

export function CompletionList({
  popup,
  detail,
  folder,
  onPick,
  onClose,
}: {
  readonly popup: CompletionPopup;
  readonly detail: CompletionItem | undefined;
  readonly folder: SelectedWorkspace | undefined;
  readonly onPick: (index: number) => void;
  readonly onClose: () => void;
}): ReactElement {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [rowHeight] = useState(() => resolveHeight(row.heightMd));
  const count = popup.ranked.length;
  const anchor = { getBoundingClientRect: () => popup.anchor };

  // oxlint-disable-next-line react/incompatible-library -- the bailout is the intended behaviour
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count,
    getScrollElement: () => viewport,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- keeps the selected row inside the list's window as the keys move it
  useLayoutEffect(() => {
    if (count > 0) virtualizer.scrollToIndex(popup.selected, { align: "auto" });
  }, [virtualizer, popup.selected, popup.ranked, count]);

  const hold = (event: SyntheticEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  const shown =
    detail !== undefined && (detail.type !== "" || detail.documentation !== "")
      ? detail
      : undefined;

  return (
    <Popover.Root open modal={false} onOpenChange={(open) => !open && onClose()}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={2}
          collisionAvoidance={MENU_COLLISION}
        >
          <Popover.Popup
            initialFocus={false}
            xstyle={styles.popup}
            onMouseDown={hold}
            onContextMenu={hold}
            onAuxClick={hold}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            {count === 0 ? (
              <div role="status" {...props(text.sm, styles.empty)}>
                No suggestions
              </div>
            ) : (
              <div
                ref={setViewport}
                role="listbox"
                aria-label="Suggestions"
                {...props(styles.list(Math.min(count, VISIBLE_ROWS) * rowHeight))}
              >
                <div {...props(styles.rows(virtualizer.getTotalSize()))}>
                  {virtualizer.getVirtualItems().flatMap((entry) => {
                    const found = popup.ranked[entry.index];

                    if (found === undefined) return [];

                    return [
                      <CompletionRow
                        key={entry.key}
                        ranked={found}
                        selected={entry.index === popup.selected}
                        offset={entry.start}
                        position={entry.index + 1}
                        count={count}
                        onPick={() => onPick(entry.index)}
                      />,
                    ];
                  })}
                </div>
              </div>
            )}
            {shown !== undefined && (
              <div {...props(hairline.blockStart, styles.detail)}>
                {shown.type !== "" && (
                  <div {...props(text.code, styles.signature)}>{shown.type}</div>
                )}
                {shown.documentation !== "" && (
                  <ChatScope folder={folder}>
                    <Prose markdown={shown.documentation} />
                  </ChatScope>
                )}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CompletionRow({
  ranked,
  selected,
  offset,
  position,
  count,
  onPick,
}: {
  readonly ranked: RankedCompletion;
  readonly selected: boolean;
  readonly offset: number;
  readonly position: number;
  readonly count: number;
  readonly onPick: () => void;
}): ReactElement {
  const item = ranked.item;
  const matched = new Set(ranked.matches);

  const parts = item.label
    .split("")
    .reduce<{ text: string; matched: boolean }[]>((found, character, index) => {
      const last = found.at(-1);
      const hit = matched.has(index);

      if (last !== undefined && last.matched === hit) last.text += character;
      else found.push({ text: character, matched: hit });

      return found;
    }, []);

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-posinset={position}
      aria-setsize={count}
      {...props(text.code, styles.row, styles.offset(offset), selected && styles.selected)}
      onClick={onPick}
    >
      <SymbolKindGlyph kind={item.kind} />
      <span {...props(styles.label, item.deprecated && styles.deprecated)}>
        {parts.map((part, index) => (
          <span key={index} {...props(part.matched && styles.match)}>
            {part.text}
          </span>
        ))}
        <span {...props(styles.tail)}>{item.tail}</span>
      </span>
      <span {...props(styles.type)}>{item.type}</span>
    </div>
  );
}

const styles = create({
  popup: {
    display: "flex",
    flexDirection: "column",
    width: "min(480px, var(--available-width))",
    padding: menu.padding,
  },
  list: (height: number) => ({
    height,
    overflowY: "auto",
    overscrollBehavior: "contain",
  }),
  rows: (height: number) => ({ position: "relative", height }),
  row: {
    position: "absolute",
    insetInline: 0,
    insetBlockStart: 0,
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    height: row.heightMd,
    paddingInline: space.s1_5,
    borderRadius: menu.itemRadius,
    color: role.contentPrimary,
    cursor: "default",
    userSelect: "none",
  },
  offset: (pixels: number) => ({ transform: `translateY(${String(pixels)}px)` }),
  selected: { backgroundColor: role.fillSecondary },
  label: {
    flex: "1 1 auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  deprecated: { textDecorationLine: "line-through" },
  match: { color: role.contentAccent },
  tail: { color: role.contentTertiary },
  type: {
    flex: "0 1 auto",
    minWidth: 0,
    maxWidth: "50%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: role.contentTertiary,
  },
  empty: { paddingBlock: space.s1, paddingInline: space.s1_5, color: role.contentSecondary },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    maxHeight: `calc(${type.leadingBase} * 10)`,
    overflowY: "auto",
    overscrollBehavior: "contain",
    marginBlockStart: menu.padding,
    paddingBlock: space.s1_5,
    paddingInline: space.s1_5,
  },
  signature: {
    color: role.contentSecondary,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});
