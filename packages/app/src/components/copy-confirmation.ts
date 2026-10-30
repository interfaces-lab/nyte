import { useRef, useState } from "react";

const COPIED_MS = 2_000;

export function useCopyConfirmation() {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = (text: string): void => {
    if (copied) return;
    void navigator.clipboard.writeText(text).then(() => {
      clearTimeout(reset.current);
      setCopied(true);
      reset.current = setTimeout(() => setCopied(false), COPIED_MS);
    });
  };

  return { copied, copy };
}
