"use client";

import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { glyph } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";

const styles = create({
  title: { fontWeight: 500 },
  detail: {
    display: "grid",
    gridTemplateColumns: `${glyph.sm} minmax(0, 1fr)`,
    alignItems: "center",
    gap: 6,
    marginBlockStart: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  detailIcon: { display: "grid", placeItems: "center", color: role.contentTertiary },
});

export function PreviewCardDemo() {
  return (
    <PreviewCard>
      <PreviewCardTrigger render={<Button variant="outline">Fix flaky tests</Button>} />
      <PreviewCardContent side="right" align="start" aria-label="Details for Fix flaky tests">
        <span {...props(styles.title)}>Fix flaky tests</span>
        <span {...props(styles.detail)}>
          <span {...props(styles.detailIcon)}>
            <Icon name="git-branch" size={14} />
          </span>
          <span>nyte-ai/nyte</span>
        </span>
        <span {...props(styles.detail)}>
          <span {...props(styles.detailIcon)}>
            <Icon name="folder" size={14} />
          </span>
          <span>~/Developer/nyte</span>
        </span>
      </PreviewCardContent>
    </PreviewCard>
  );
}
