import { create, props } from "@stylexjs/stylex";
import { Dialog } from "@nyte-ai/ui/dialog";
import type { ReactElement } from "react";
import { Icon } from "../components/icons.tsx";
import { focus } from "../components/ui.tsx";
import { layer } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";

const styles = create({
  trigger: {
    appearance: "none",
    display: "inline-flex",
    flexShrink: 0,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusBase,
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
    borderRadius: t.radiusBase,
    outlineWidth: 1,
    outlineStyle: "solid",
    outlineColor: t.imageOutline,
    outlineOffset: -1,
  },
  compact: { width: 64, height: 64 },
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: layer.dialogBackdrop,
    backgroundColor: t.bgScrim,
  },
  popup: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: layer.dialog,
    width: "max-content",
    maxWidth: "calc(100vw - 48px)",
    maxHeight: "calc(100dvh - 48px)",
    padding: 8,
    borderRadius: t.radiusXl,
    backgroundColor: t.imageBg,
    boxShadow: t.shadowModal,
    outline: "none",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    minHeight: 40,
    paddingInlineStart: 8,
    color: t.textSecondary,
  },
  title: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: t.fontBase,
    fontWeight: 500,
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
    borderRadius: t.radiusBase,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.iconSecondary,
    cursor: "pointer",
  },
  image: {
    display: "block",
    width: "auto",
    height: "auto",
    maxWidth: "calc(100vw - 64px)",
    maxHeight: "calc(100dvh - 104px)",
    marginInline: "auto",
    objectFit: "contain",
    borderRadius: t.radiusBase,
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
      <Dialog.Trigger
        type="button"
        aria-label={`Preview ${name}`}
        title={name}
        {...props(styles.trigger, focus.ring)}
      >
        <img src={src} alt={name} {...props(styles.thumbnail, compact && styles.compact)} />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop {...props(styles.backdrop)} />
        <Dialog.Popup {...props(styles.popup)}>
          <div {...props(styles.toolbar)}>
            <Dialog.Title {...props(styles.title)}>{name}</Dialog.Title>
            <Dialog.Close
              type="button"
              aria-label="Close image preview"
              {...props(styles.close, focus.ring)}
            >
              <Icon name="x" size={16} />
            </Dialog.Close>
          </div>
          <img src={src} alt={name} {...props(styles.image)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
