import { PreviewCard } from "@nyte-ai/ui/primitives";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import type { GitHubRepository } from "../../../shared/ipc.ts";
import { Icon } from "../components/icons.tsx";
import { ContextMenu } from "../components/menu.tsx";
import { floatingSurfaceStyles } from "../theme/floating-surface.stylex.ts";
import { layer } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";

const styles = stylex.create({
  positioner: { zIndex: layer.menu, outline: "none" },
  popup: {
    display: "flex",
    flexDirection: "column",
    width: "max-content",
    maxWidth: "min(260px, var(--available-width))",
    padding: 8,
    borderStyle: "none",
    borderRadius: t.radiusLg,
    outline: "none",
    color: t.textPrimary,
    transformOrigin: "var(--transform-origin)",
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    scale: {
      default: 1,
      "[data-starting-style]": 0.98,
      "[data-ending-style]": 0.98,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transitionProperty: "opacity, scale",
    transitionDuration: {
      default: t.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
  },
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
        <PreviewCard.Positioner
          side="right"
          align="start"
          alignOffset={-4}
          sideOffset={4}
          positionMethod="fixed"
          collisionPadding={8}
          {...stylex.props(styles.positioner)}
        >
          <PreviewCard.Popup
            aria-label={`Details for ${title}`}
            {...stylex.props(floatingSurfaceStyles.popup, styles.popup)}
          >
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
