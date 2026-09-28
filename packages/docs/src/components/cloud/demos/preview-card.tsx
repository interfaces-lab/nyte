"use client";

import { focus } from "@nyte-ai/ui/a11y.stylex";
import { PreviewCard } from "@nyte-ai/ui/preview-card";
import { t } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";

const styles = create({
  link: {
    color: t.textAccent,
    fontSize: t.fontBase,
    textDecorationLine: "underline",
    textUnderlineOffset: "2px",
  },
  title: { fontWeight: 500 },
  detail: { color: t.textSecondary, fontSize: t.fontSm, lineHeight: t.leadingSm },
});

export function PreviewCardDemo() {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger href="/cloud/components/button" {...props(styles.link, focus.ring)}>
        Button
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner sideOffset={8}>
          <PreviewCard.Popup>
            <span {...props(styles.title)}>Button</span>
            <span {...props(styles.detail)}>Variants and sizes.</span>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
