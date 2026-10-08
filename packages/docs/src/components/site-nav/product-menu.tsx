"use client";

import { Popover } from "@nyte-ai/ui/popover";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import Link from "next/link";
import { useState } from "react";
import { products } from "~/lib/products";

const styles = create({
  popup: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    width: 300,
    padding: 8,
    borderRadius: radius.surface,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    paddingInline: 12,
    paddingBlock: 10,
    borderRadius: radius.card,
    color: role.contentPrimary,
    textDecoration: "none",
    outline: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": role.bgHover,
      ":focus-visible": role.bgHover,
    },
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontWeight: 500,
  },
  description: {
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    color: role.contentSecondary,
  },
  soon: {
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: radius.pill,
    backgroundColor: role.bgMuted,
    color: role.contentTertiary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontWeight: 400,
  },
});

/* The hosts as one list, in the popover's card metrics. */
export function ProductMenu({ triggerClass }: { triggerClass: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={80}
        className={`${triggerClass} cursor-pointer data-popup-open:bg-current/10`}
      >
        Product
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8}>
          <Popover.Popup aria-label="Product" xstyle={styles.popup}>
            {products.map((product) => (
              <Link
                key={product.title}
                href={product.href}
                onClick={() => setOpen(false)}
                {...props(styles.item)}
              >
                <span {...props(styles.title)}>
                  {product.title}
                  {product.soon ? <span {...props(styles.soon)}>Soon</span> : null}
                </span>
                <span {...props(styles.description)}>{product.description}</span>
              </Link>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
