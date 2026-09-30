import { Dialog } from "@nyte-ai/ui/dialog";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { AppInfo } from "../bridge.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { t } from "@nyte-ai/ui/vars.stylex";

const styles = create({
  popup: {
    alignItems: "center",
    gap: 0,
    width: "min(440px, calc(100vw - 48px))",
    padding: 32,
    borderStyle: "none",
    borderRadius: 20,
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
    color: t.contentInteractiveSecondary,
    backgroundColor: { default: "transparent", ":hover": t.bgHover },
    cursor: t.cursorInteractive,
  },
  icon: {
    width: 112,
    height: 112,
    marginBottom: 12,
    flexShrink: 0,
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
    color: t.contentSecondary,
    fontSize: 15,
    lineHeight: 1.5,
    fontVariantNumeric: "tabular-nums",
  },
  credit: {
    margin: "20px 0 24px",
    color: t.contentSecondary,
    fontSize: 13,
    lineHeight: 1.5,
  },
  error: { margin: "12px 0 0", color: t.intentDangerContent, fontSize: t.fontBase },
});

export function AboutDialog({
  info,
  icon,
  onClose,
}: {
  info: AppInfo;
  icon: string;
  onClose: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Popup xstyle={styles.popup}>
        <Dialog.Close aria-label="Close About" xstyle={[styles.close, focus.ring]}>
          <Icon name="x" size={20} />
        </Dialog.Close>
        <img src={icon} alt="" width={112} height={112} {...props(styles.icon)} />
        <Dialog.Title xstyle={styles.title}>{info.name}</Dialog.Title>
        <Dialog.Description xstyle={styles.version}>Version {info.version}</Dialog.Description>
        <p {...props(styles.credit)}>Made by Interfaces</p>
        <Button
          variant="secondary"
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
          <span aria-live="polite">{copyStatus === "copied" ? "Copied" : "Copy version info"}</span>
        </Button>
        {copyStatus === "failed" && (
          <p role="alert" {...props(styles.error)}>
            Couldn't copy version info. Try again.
          </p>
        )}
      </Dialog.Popup>
    </Dialog.Root>
  );
}
