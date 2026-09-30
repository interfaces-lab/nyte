import { create, props } from "@stylexjs/stylex";
import { Dialog } from "@nyte-ai/ui/dialog";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { Hint } from "@nyte-ai/ui/tooltip";
import { t } from "@nyte-ai/ui/vars.stylex";

const styles = create({
  trigger: {
    appearance: "none",
    display: "inline-flex",
    flexShrink: 0,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radius6,
    backgroundColor: t.imageBg,
    boxShadow: "none",
    cursor: "zoom-in",
    overflow: "hidden",
  },
  thumbnail: {
    display: "block",
    width: 80,
    height: 80,
    objectFit: "cover",
    borderRadius: t.radius6,
    outlineWidth: 1,
    outlineStyle: "solid",
    outlineColor: t.borderPrimaryTranslucent,
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
    backgroundColor: t.bgElevated,
    backdropFilter: "none",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    minHeight: 40,
    paddingInlineStart: 8,
    color: t.contentSecondary,
  },
  title: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: t.contentSecondary,
    fontSize: t.fontBase,
    fontWeight: 500,
    lineHeight: t.leadingBase,
  },
  close: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 40,
    height: 40,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radius6,
    backgroundColor: { default: "transparent", ":hover": t.bgHover },
    color: t.contentInteractiveSecondary,
    cursor: t.cursorInteractive,
  },
  image: {
    display: "block",
    width: "auto",
    height: "auto",
    maxWidth: "calc(100vw - 64px)",
    maxHeight: "calc(100dvh - 104px)",
    marginInline: "auto",
    objectFit: "contain",
    borderRadius: t.radius6,
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
      <Hint
        content={name}
        trigger={
          <Dialog.Trigger
            type="button"
            aria-label={`Preview ${name}`}
            xstyle={[styles.trigger, focus.ring]}
          >
            <img src={src} alt={name} {...props(styles.thumbnail, compact && styles.compact)} />
          </Dialog.Trigger>
        }
      />
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
