"use client";

import { intent } from "@nyte-ai/ui/surface-theme";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { PreviewCard } from "@nyte-ai/ui/preview-card";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";

const styles = create({
  link: {
    color: role.contentSecondary,
    fontSize: type.fontBase,
    textDecorationLine: "underline",
    textUnderlineOffset: "2px",
  },
  title: { fontWeight: 500 },
  detail: { color: role.contentSecondary, fontSize: type.fontSm, lineHeight: type.leadingSm },
});

export function PreviewCardDemo() {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        href="/cloud/components/button"
        {...props(intent.primary, styles.link, focus.ring)}
      >
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
