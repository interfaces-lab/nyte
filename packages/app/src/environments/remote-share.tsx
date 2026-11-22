import { props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { Button } from "@nyte-ai/ui/button";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";

const COPIED_MS = 1500;

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
