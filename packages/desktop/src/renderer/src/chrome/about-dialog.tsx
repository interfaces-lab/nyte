import { Dialog } from "@nyte-ai/ui/dialog";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { AppInfo } from "../../../shared/app-menu.ts";
import appIcon from "../../../../build/icon-macos.svg";
import { Icon } from "../components/icons.tsx";
import { overlayRef } from "../components/overlay-occlusion.ts";
import { focus } from "../components/ui.tsx";
import { layer } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";

const styles = create({
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
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "min(440px, calc(100vw - 48px))",
    maxHeight: "calc(100dvh - 48px)",
    overflowY: "auto",
    padding: "36px 32px 32px",
    borderRadius: 20,
    outline: "none",
    backgroundColor: t.bgElevated,
    boxShadow: t.shadowModal,
    color: t.textPrimary,
    textAlign: "center",
  },
  close: {
    position: "absolute",
    top: 10,
    right: 10,
    display: "grid",
    placeItems: "center",
    width: 40,
    height: 40,
    padding: 0,
    borderStyle: "none",
    borderRadius: "50%",
    color: t.iconSecondary,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    cursor: "pointer",
  },
  icon: {
    width: 112,
    height: 112,
    marginBottom: 12,
    flexShrink: 0,
    filter: "drop-shadow(0 12px 16px rgb(0 0 0 / 0.18))",
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 600,
    lineHeight: 1.2,
    letterSpacing: "-0.8px",
    textWrap: "balance",
  },
  version: {
    margin: "8px 0 0",
    color: t.textSecondary,
    fontSize: 15,
    lineHeight: 1.5,
    fontVariantNumeric: "tabular-nums",
  },
  credit: {
    margin: "20px 0 28px",
    color: t.textSecondary,
    fontSize: 13,
    lineHeight: 1.5,
  },
  copy: {
    minHeight: 40,
    minWidth: 164,
    padding: "8px 16px",
    borderStyle: "none",
    borderRadius: 10,
    backgroundColor: { default: t.fillSecondary, ":hover": t.fillGhostHover },
    boxShadow: `inset 0 0 0 1px ${t.strokeSecondary}`,
    color: t.textPrimary,
    fontSize: 14,
    lineHeight: 1.5,
    cursor: "pointer",
  },
  error: { margin: "12px 0 0", color: t.textDanger, fontSize: t.fontBase },
});

export function AboutDialog({ info, onClose }: { info: AppInfo; onClose: () => void }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop ref={overlayRef} {...props(styles.backdrop)} />
        <Dialog.Popup {...props(styles.popup)}>
          <Dialog.Close aria-label="Close About" {...props(styles.close, focus.ring)}>
            <Icon name="x" size={20} />
          </Dialog.Close>
          <img src={appIcon} alt="" width={112} height={112} {...props(styles.icon)} />
          <Dialog.Title {...props(styles.title)}>{info.name}</Dialog.Title>
          <Dialog.Description {...props(styles.version)}>Version {info.version}</Dialog.Description>
          <p {...props(styles.credit)}>Made by Interfaces</p>
          <button
            type="button"
            {...props(styles.copy, focus.ring)}
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  [
                    `${info.name} ${info.version}`,
                    `${info.os} (${info.arch})`,
                    `Electron ${info.electron}`,
                    `Chromium ${info.chrome}`,
                  ].join("\n"),
                )
                .then(
                  () => setCopyStatus("copied"),
                  () => setCopyStatus("failed"),
                );
            }}
          >
            <span aria-live="polite">
              {copyStatus === "copied" ? "Copied" : "Copy version info"}
            </span>
          </button>
          {copyStatus === "failed" && (
            <p role="alert" {...props(styles.error)}>
              Couldn't copy version info. Try again.
            </p>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
