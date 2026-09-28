"use client";

import { useEffect, useRef } from "react";

/*
 * Pierre's prerendered diff in a shadow root. A full page load parses the
 * declarative template; after a client navigation React only sets innerHTML,
 * which leaves the template inert, so the root is attached here instead.
 */
export function PrerenderedDiff({ html, className }: { html: string; className: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host || host.shadowRoot) return;
    host.attachShadow({ mode: "open" }).innerHTML = html;
  }, [html]);

  return (
    <div
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: `<template shadowrootmode="open">${html}</template>` }}
      suppressHydrationWarning
    />
  );
}
