import { intent } from "@nyte-ai/ui/surface-theme";
import { Dialog } from "@nyte-ai/ui/dialog";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { AppInfo } from "../bridge.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { appearance, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";

const styles = create({
  popup: {
    alignItems: "center",
    gap: 0,
    width: "min(440px, calc(100vw - 48px))",
    padding: space.s8,
    borderStyle: "none",
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
    color: role.contentInteractiveSecondary,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
    },
    cursor: appearance.cursorInteractive,
  },
  icon: {
    width: 112,
    height: 112,
    marginBottom: space.s3,
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: type.weightSemibold,
    lineHeight: "34px",
    letterSpacing: "-0.8px",
    textWrap: "balance",
  },
  version: {
    margin: `${space.s2} 0 0`,
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  credit: {
    margin: `${space.s5} 0 ${space.s6}`,
    color: role.contentSecondary,
  },
  error: { margin: `${space.s3} 0 0`, color: role.contentSecondary, fontSize: type.fontBase },
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
        <Dialog.Description xstyle={[text.lg, styles.version]}>
          Version {info.version}
        </Dialog.Description>
        <p {...props(text.base, styles.credit)}>Made by Interfaces</p>
        <Button
          variant="outline"
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
          <p role="alert" {...props(intent.danger, styles.error)}>
            Couldn't copy version info. Try again.
          </p>
        )}
      </Dialog.Popup>
    </Dialog.Root>
  );
}
