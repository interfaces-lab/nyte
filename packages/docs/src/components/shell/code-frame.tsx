"use client";

import { IconCheckmark1Small, IconClipboard } from "central-icons";
import { useRef, useState } from "react";
import type { ComponentProps } from "react";
import type { ShellSkin } from "~/shell.stylex";

export type ShellCodeFrameProps = ComponentProps<"pre"> & {
  skin: ShellSkin;
  title?: string;
  icon?: unknown;
};

/*
 * The `pre` renderer for doc pages. fumadocs-mdx hands us Shiki's output
 * plus unused fence meta. The copy button reads the rendered text so it
 * never disagrees with what is on screen.
 */
export function ShellCodeFrame({
  skin,
  title: _title,
  icon: _icon,
  children,
  className,
  ...props
}: ShellCodeFrameProps) {
  const body = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  return (
    <figure className={`${skin}-code`}>
      <div className={`${skin}-code-body`}>
        <pre ref={body} className={className} {...props}>
          {children}
        </pre>
        <button
          type="button"
          className={`${skin}-code-copy`}
          aria-label={copied ? "Copied" : "Copy code"}
          onClick={async () => {
            await navigator.clipboard.writeText(body.current?.textContent ?? "");
            setCopied(true);
            setTimeout(() => setCopied(false), 1300);
          }}
        >
          {copied ? <IconCheckmark1Small size={14} /> : <IconClipboard size={14} />}
        </button>
      </div>
    </figure>
  );
}
