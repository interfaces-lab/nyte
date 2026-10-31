import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { Button } from "@nyte-ai/ui/button";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";

const COPIED_MS = 1500;

export const shareStyles = create({
  pair: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s3,
  },
  value: {
    minWidth: 0,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    userSelect: "all",
  },
  actions: { display: "inline-flex", alignItems: "center", gap: space.s1 },
});

/** Copies a value and shows a checkmark for a moment. */
export function CopyButton({ label, value }: { label: string; value: string }): ReactElement {
  const [copied, setCopied] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        iconOnly
        icon={copied ? "checkmark" : "copy"}
        aria-label={`Copy ${label.toLocaleLowerCase()}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), COPIED_MS);
            },
            () => {
              setCopied(false);
              toast.add({
                type: "error",
                title: `Couldn't copy the ${label.toLocaleLowerCase()}. Select it and copy it yourself.`,
              });
            },
          );
        }}
      />
      <span role="status" {...props(srOnly)}>
        {copied ? `${label} copied` : ""}
      </span>
    </>
  );
}

/** A row showing one value to hand to another device, with its actions at the end. */
export function ValueRow({
  title,
  value,
  children,
}: {
  readonly title: string;
  readonly value: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div data-settings-row="" {...props(settingsPatterns.rowRule, settingsPatterns.row)}>
      <span {...props(settingsPatterns.rowCopy)}>
        <span {...props(settingsPatterns.rowTitle)}>{title}</span>
        <code aria-label={title} {...props(shareStyles.value)}>
          {value}
        </code>
      </span>
      <span {...props(shareStyles.actions)}>{children}</span>
    </div>
  );
}
