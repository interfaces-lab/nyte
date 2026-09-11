"use client";

import { IconCheckmark1Small, IconClipboard } from "central-icons";
import { useRef, useState } from "react";
import type { ComponentProps } from "react";

/*
 * The `pre` renderer for Cloud pages. fumadocs-mdx hands us Shiki's output
 * plus `title` from the fence meta; the frame adds the header and a copy
 * button that reads the rendered text so it never disagrees with what is on
 * screen.
 */
export function CodeFrame({
  title,
  icon: _icon,
  children,
  className,
  ...props
}: ComponentProps<"pre"> & { title?: string; icon?: unknown }) {
  const body = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  return (
    <figure className="cloud-code">
      {title && (
        <figcaption className="cloud-code-head">
          <span>{title}</span>
        </figcaption>
      )}
      <div className="cloud-code-body">
        <pre ref={body} className={className} {...props}>
          {children}
        </pre>
        <button
          type="button"
          className="cloud-icon-button"
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
