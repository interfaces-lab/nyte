import { Button } from "@nyte-ai/ui/button";
import { control, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, Ref } from "react";

/** The main area's status bar: the branch, then the focused file's status, which its editor portals into `slot`. */
export function EditorStatusBar({
  branch,
  slot,
  onBranch,
}: {
  readonly branch: string | undefined;
  readonly slot: Ref<HTMLDivElement>;
  readonly onBranch: () => void;
}): ReactElement {
  return (
    <div {...props(styles.bar)}>
      {branch !== undefined && (
        <span {...props(styles.branch)}>
          <Button
            size="2xs"
            variant="plain"
            icon="git-branch"
            title="Show Changes"
            onClick={onBranch}
          >
            {branch}
          </Button>
        </span>
      )}
      <div ref={slot} {...props(styles.slot)} />
    </div>
  );
}

const styles = create({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    minHeight: control.heightMd,
    paddingInline: space.s1_5,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingSm,
  },
  branch: { display: "flex", flexShrink: 1, minWidth: 0 },
  slot: { display: "flex", alignItems: "center", gap: space.s2, flex: 1, minWidth: 0 },
});
