import { PreviewCard } from "@nyte-ai/ui/preview-card";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import type { GitHubRepository } from "../bridge.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { ContextMenu } from "@nyte-ai/ui/context-menu";
import { t } from "@nyte-ai/ui/vars.stylex";

const styles = stylex.create({
  title: {
    overflow: "hidden",
    color: t.textPrimary,
    fontSize: t.fontBase,
    fontWeight: 500,
    lineHeight: t.leadingBase,
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
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  detailIcon: {
    display: "grid",
    placeItems: "center",
    width: 14,
    height: t.leadingSm,
    color: t.iconTertiary,
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
    <PreviewCard.Root>
      {contextMenu === undefined ? (
        <PreviewCard.Trigger render={trigger} delay={600} closeDelay={100} />
      ) : (
        <ContextMenu
          label={`Actions for ${title}`}
          trigger={<PreviewCard.Trigger render={trigger} delay={600} closeDelay={100} />}
        >
          {contextMenu}
        </ContextMenu>
      )}
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="right" align="start" alignOffset={-4} sideOffset={4}>
          <PreviewCard.Popup aria-label={`Details for ${title}`}>
            <div {...stylex.props(styles.title)}>{title}</div>
            {context.kind === "workspace" && (
              <div {...stylex.props(styles.details)}>
                {context.repository !== undefined && (
                  <div {...stylex.props(styles.detail)}>
                    <span {...stylex.props(styles.detailIcon)}>
                      <Icon name="git-branch" size={14} />
                    </span>
                    <span {...stylex.props(styles.detailText)}>
                      {context.repository.owner}/{context.repository.name}
                    </span>
                  </div>
                )}
                <div {...stylex.props(styles.detail)}>
                  <span {...stylex.props(styles.detailIcon)}>
                    <Icon name="folder" size={14} />
                  </span>
                  <span title={context.path} {...stylex.props(styles.detailText)}>
                    {context.path}
                  </span>
                </div>
              </div>
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
