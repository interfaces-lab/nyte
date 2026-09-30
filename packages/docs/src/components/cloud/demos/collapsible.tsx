"use client";

import { Collapsible } from "@nyte-ai/ui/collapsible";
import { t } from "@nyte-ai/ui/vars.stylex";
import { create } from "@stylexjs/stylex";

const styles = create({
  root: { display: "flex", flexDirection: "column", width: 280 },
  trigger: { fontSize: t.fontBase, lineHeight: t.leadingBase },
  panel: {
    marginTop: 4,
    paddingInlineStart: 15,
    color: t.contentSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
});

export function CollapsibleDemo() {
  return (
    <Collapsible.Root xstyle={styles.root}>
      <Collapsible.Trigger xstyle={styles.trigger}>
        <Collapsible.Chevron />
        Advanced settings
      </Collapsible.Trigger>
      <Collapsible.Panel xstyle={styles.panel}>
        Tools run without a confirmation prompt while this session is trusted.
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
