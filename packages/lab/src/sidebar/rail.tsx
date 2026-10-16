import { create, props } from "@stylexjs/stylex";
import { useId, useState, type ReactElement, type ReactNode } from "react";
import { sidebarStyles as rail } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

/** A folded group of rows under one header that says how many it holds. */
export function Shelf({
  label,
  count,
  leading,
  defaultOpen = false,
  children,
}: {
  readonly label: string;
  readonly count: number;
  readonly leading: ReactNode;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} xstyle={rail.section}>
      <Collapsible.Trigger
        variant="plain"
        aria-controls={panelId}
        xstyle={[styles.shelf, focus.ringInset]}
      >
        <span {...props(rail.rowIcon, styles.shelfLeading)}>{leading}</span>
        <span {...props(styles.shelfLabel)}>{label}</span>
        <span {...props(styles.shelfCount)}>{count}</span>
        <Collapsible.Chevron xstyle={styles.shelfChevron} />
      </Collapsible.Trigger>
      <Collapsible.Panel id={panelId} hiddenUntilFound={false} xstyle={styles.shelfPanel}>
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

const styles = create({
  shelf: {
    display: "flex",
    alignItems: "center",
    gap: sidebar.rowGap,
    width: "100%",
    minHeight: sidebar.rowHeight,
    paddingInline: sidebar.rowPaddingInline,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    "--_shelf-chevron-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover) and (pointer: fine)": "1" },
      ":focus-visible": "1",
    },
  },
  shelfLeading: { display: "grid", placeItems: "center" },
  shelfLabel: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  shelfCount: {
    color: role.contentTertiary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontVariantNumeric: "tabular-nums",
  },
  shelfChevron: { marginInlineStart: "auto", opacity: "var(--_shelf-chevron-opacity)" },
  shelfPanel: {
    display: { default: "flex", "[hidden]": "none" },
    flexDirection: "column",
    gap: sidebar.listGap,
  },
});
