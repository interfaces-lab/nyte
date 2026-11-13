import { create, props } from "@stylexjs/stylex";
import type { KeyboardEvent, ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Toggle } from "@nyte-ai/ui/toggle";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { BROWSER_DESIGN_VIEW_KEYS } from "../../contract/bridge.ts";
import type { BrowserDesignChange, BrowserDesignViews } from "../../contract/bridge.ts";

const VIEWS = {
  xray: { label: "X-ray", icon: "eye", title: "Outline every element" },
  rulers: {
    label: "Rulers",
    icon: "ruler",
    title: "Page pixels along the edges. Press a ruler to add a guide",
  },
  grid: { label: "Grid", icon: "canvas-grid", title: "Grid and flex tracks and gaps" },
  contrast: { label: "Contrast", icon: "circles", title: "Mark text below WCAG AA" },
} as const satisfies Record<
  keyof BrowserDesignViews,
  { readonly label: string; readonly icon: string; readonly title: string }
>;

const VIEW_KEYS = new Map(Object.entries(BROWSER_DESIGN_VIEW_KEYS));

export function DesignBar({
  views,
  onChange,
  onPointerDone,
}: {
  readonly views: BrowserDesignViews;
  readonly onChange: (change: BrowserDesignChange) => void;
  readonly onPointerDone: () => void;
}): ReactElement {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat;
    const view = event.shiftKey && plain ? VIEW_KEYS.get(event.code) : undefined;

    if (view !== undefined) onChange({ kind: "view", view, shown: !views[view] });
    else if (event.key === "Escape" && plain && !event.shiftKey) onChange({ kind: "off" });
    else return;

    event.preventDefault();
  };

  return (
    <div
      {...props(styles.bar, hairline.blockEnd)}
      onKeyDown={onKeyDown}
      onPointerUp={onPointerDone}
    >
      <Button
        iconOnly
        size="sm"
        icon="x"
        aria-label="Exit Design Mode"
        onClick={() => onChange({ kind: "off" })}
      />
      <span {...props(text.sm, styles.hint)}>
        <b {...props(styles.verb)}>Click</b> an element or <b {...props(styles.verb)}>drag</b> an
        area to add it to the chat · <Kbd keys={["↑"]} /> for the parent · <Kbd keys={["Esc"]} /> to
        exit
      </span>
      {Object.entries(BROWSER_DESIGN_VIEW_KEYS).map(([code, view]) => (
        <Toggle
          key={view}
          size="sm"
          icon={VIEWS[view].icon}
          aria-keyshortcuts={`Shift+${code.slice("Key".length)}`}
          title={`${VIEWS[view].title} (⇧${code.slice("Key".length)})`}
          pressed={views[view]}
          onPressedChange={(shown) => onChange({ kind: "view", view, shown })}
        >
          {VIEWS[view].label}
        </Toggle>
      ))}
    </div>
  );
}

const styles = create({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    flexShrink: 0,
    paddingBlock: space.s1,
    paddingInline: space.s1_5,
    backgroundColor: role.bgBase,
  },
  hint: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: role.contentSecondary,
  },
  verb: { color: role.contentPrimary, fontWeight: type.weightMedium },
});
