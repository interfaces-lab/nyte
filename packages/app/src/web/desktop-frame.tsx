import { Icon } from "@nyte-ai/ui/icon";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

const styles = create({
  frame: { display: "flex", flexDirection: "column", height: "100%" },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s1,
    paddingInline: space.s3,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    backgroundColor: role.bgBase,
    color: role.contentSecondary,
  },
  name: {
    flex: 1,
    minWidth: 0,
    color: role.contentPrimary,
    overflowWrap: "anywhere",
  },
  shell: { flex: 1, minHeight: 0, position: "relative" },
});

/** The app under a bar naming the desktop it reaches, with the actions that leave it. */
export function DesktopFrame({
  name,
  actions,
  children,
}: {
  readonly name: string;
  readonly actions: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.frame)}>
      <div {...props(text.sm, styles.bar)}>
        <Icon name="laptop" size={14} />
        <span {...props(styles.name)}>{name}</span>
        {actions}
      </div>
      <div {...props(styles.shell)}>{children}</div>
    </div>
  );
}
