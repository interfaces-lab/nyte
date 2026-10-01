import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import type { GitHubRepository } from "../bridge.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { ContextMenu } from "@nyte-ai/ui/context-menu";
import { role, type } from "@nyte-ai/ui/vars.stylex";

const styles = create({
  title: {
    overflow: "hidden",
    color: role.contentPrimary,
    fontSize: type.fontBase,
    fontWeight: 500,
    lineHeight: type.leadingBase,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  details: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginBlockStart: 6,
  },
  detail: {
    display: "grid",
    gridTemplateColumns: "14px minmax(0, 1fr)",
    alignItems: "center",
    gap: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  detailIcon: {
    display: "grid",
    placeItems: "center",
    width: 14,
    height: type.leadingSm,
    color: role.contentTertiary,
  },
  detailText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

export type SessionPreviewContext =
  | { readonly kind: "home" }
  /** Runs on the connected server; no local folder to name. */
  | { readonly kind: "cloud" }
  | {
      readonly kind: "workspace";
      readonly path: string;
      readonly repository: Pick<GitHubRepository, "owner" | "name"> | undefined;
    };

export function SessionPreviewCard({
  title,
  context,
  trigger,
  contextMenu,
}: {
  readonly title: string;
  readonly context: SessionPreviewContext;
  readonly trigger: ReactElement;
  readonly contextMenu?: ReactNode;
}): ReactElement {
  return (
    <PreviewCard>
      {contextMenu === undefined ? (
        <PreviewCardTrigger render={trigger} delay={600} closeDelay={100} />
      ) : (
        <ContextMenu
          label={`Options for ${title}`}
          trigger={<PreviewCardTrigger render={trigger} delay={600} closeDelay={100} />}
        >
          {contextMenu}
        </ContextMenu>
      )}
      <PreviewCardContent
        side="right"
        align="start"
        alignOffset={-4}
        sideOffset={4}
        aria-label={`Details for ${title}`}
      >
        <div {...props(styles.title)}>{title}</div>
        {context.kind === "workspace" && (
          <div {...props(styles.details)}>
            {context.repository !== undefined && (
              <div {...props(styles.detail)}>
                <span {...props(styles.detailIcon)}>
                  <Icon name="git-branch" size={14} />
                </span>
                <span {...props(styles.detailText)}>
                  {context.repository.owner}/{context.repository.name}
                </span>
              </div>
            )}
            <div {...props(styles.detail)}>
              <span {...props(styles.detailIcon)}>
                <Icon name="folder" size={14} />
              </span>
              <span title={context.path} {...props(styles.detailText)}>
                {context.path}
              </span>
            </div>
          </div>
        )}
      </PreviewCardContent>
    </PreviewCard>
  );
}
