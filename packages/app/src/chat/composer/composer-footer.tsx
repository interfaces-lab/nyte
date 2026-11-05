import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { control, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { useChat } from "../../chats/index.ts";
import { nyte } from "../../contract/nyte.ts";
import { BranchSegment } from "../../panes/branch-segment.tsx";
import { EnvironmentMenu } from "../../panes/environment-menu.tsx";

const styles = create({
  footer: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    paddingBlock: space.s0_5,
    paddingInline: space.s1,
    // A 1 px transparent border on each edge leaves 3 px around the 20 px segments.
    borderBlockWidth: space.px,
    borderBlockStyle: "solid",
    borderBlockColor: "transparent",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingBase,
  },
  segments: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    minWidth: 0,
    height: control.heightXs,
  },
});

export function ComposerFooter({
  sessionId,
  active,
}: {
  readonly sessionId: SessionId;
  readonly active: boolean;
}): ReactElement {
  const chat = useChat(sessionId);
  const location = chat.kind === "ready" ? chat.chat.location : undefined;

  return (
    <div data-composer-footer {...props(styles.footer)}>
      <div {...props(styles.segments)}>
        {location?.kind === "folder" && (
          <BranchSegment
            workspace={location.workspace}
            switchable={location.worktree === null}
            size="xs"
          />
        )}
        {nyte.clientSurface === "desktop" && <EnvironmentMenu active={active} size="xs" />}
      </div>
    </div>
  );
}
