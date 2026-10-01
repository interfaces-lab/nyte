import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { shape, target } from "@nyte-ai/ui/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { Dialog } from "@nyte-ai/ui/dialog";
import { AttachmentTrigger } from "@nyte-ai/ui/attachment";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";

const styles = create({
  trigger: {
    appearance: "none",
    display: "inline-flex",
    flexShrink: 0,
    padding: 0,
    borderStyle: "none",
    borderRadius: shape.control,
    backgroundColor: role.bgBase,
    boxShadow: "none",
    cursor: "zoom-in",
    overflow: "hidden",
  },
  thumbnail: {
    display: "block",
    width: 80,
    height: 80,
    objectFit: "cover",
    borderRadius: shape.control,
    outlineWidth: 1,
    outlineStyle: "solid",
    outlineColor: role.borderPrimaryTranslucent,
    outlineOffset: -1,
  },
  compact: { width: 64, height: 64 },
  popup: {
    display: "block",
    width: "max-content",
    maxWidth: "calc(100vw - 48px)",
    padding: 8,
    overflowY: "visible",
    borderStyle: "none",
    backgroundColor: role.bgElevated,
    backdropFilter: "none",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    minHeight: 40,
    paddingInlineStart: 8,
    color: role.contentSecondary,
  },
  title: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: role.contentSecondary,
    fontSize: type.fontBase,
    fontWeight: 500,
    lineHeight: type.leadingBase,
  },
  close: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 40,
    height: 40,
    minWidth: target.min,
    minHeight: target.min,
    padding: 0,
    borderStyle: "none",
    borderRadius: shape.control,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    color: {
      default: role.contentSecondary,
      ":hover": role.contentPrimary,
      ":active": role.contentPrimary,
    },
    cursor: appearance.cursorInteractive,
  },
  image: {
    display: "block",
    width: "auto",
    height: "auto",
    maxWidth: "calc(100vw - 64px)",
    maxHeight: "calc(100dvh - 104px)",
    marginInline: "auto",
    objectFit: "contain",
    borderRadius: shape.control,
  },
});

/** The original image dimensions determine the preview, capped only by the window. */
export function ImagePreview({
  src,
  name,
  compact = false,
}: {
  readonly src: string;
  readonly name: string;
  readonly compact?: boolean;
}): ReactElement {
  return (
    <Dialog.Root>
      <Tooltip>
        <TooltipTrigger
          render={
            <AttachmentTrigger
              type="button"
              aria-label={`Preview ${name}`}
              render={<Dialog.Trigger xstyle={[surfaceTheme.gray, styles.trigger, focus.ring]} />}
            >
              <img src={src} alt={name} {...props(styles.thumbnail, compact && styles.compact)} />
            </AttachmentTrigger>
          }
        />
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
      <Dialog.Popup xstyle={styles.popup}>
        <div {...props(styles.toolbar)}>
          <Dialog.Title xstyle={styles.title}>{name}</Dialog.Title>
          <Dialog.Close
            type="button"
            aria-label="Close image preview"
            xstyle={[styles.close, focus.ring]}
          >
            <Icon name="x" size={16} />
          </Dialog.Close>
        </div>
        <img src={src} alt={name} {...props(styles.image)} />
      </Dialog.Popup>
    </Dialog.Root>
  );
}
