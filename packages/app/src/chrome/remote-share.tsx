/** What a client needs to connect, shown so it can be scanned or copied whole. */
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { Button } from "@nyte-ai/ui/button";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

export const shareStyles = create({
  panel: { display: "flex", flexDirection: "column", gap: space.s2 },
  step: { display: "flex", flexDirection: "column", gap: space.s2 },
  switcher: { alignSelf: "flex-start" },
  scan: { display: "flex", alignItems: "center", gap: space.s3 },
  scanText: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  /** One grid for both fields, so the value boxes share a left edge and width. */
  fields: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: space.s2,
    rowGap: space.s1_5,
  },
  label: {
    color: role.contentSecondary,
  },
  fieldActions: { display: "inline-flex", gap: space.s2 },
  /** Selected whole, so a click cannot grab half of a token or address. */
  value: {
    boxSizing: "border-box",
    minWidth: 0,
    paddingInline: space.s2,
    paddingBlock: space.s1,
    borderRadius: radius.control,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontVariantNumeric: "tabular-nums",
    userSelect: "all",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

export function CopyButton({ label, value }: { label: string; value: string }): ReactElement {
  const [copied, setCopied] = useState(false);

  return (
    <>
      <Button
        iconOnly
        icon={copied ? "checkmark" : "copy"}
        aria-label={`Copy ${label.toLocaleLowerCase()}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => setCopied(true),
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
