"use client";

import { platformScopes } from "@nyte-ai/ui/platform-colors";
import { role } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
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

  const themed = props(
    styles.host,
    styles.palette(
      `light-dark(${platformScopes.light.green.bgInteractiveSecondaryTranslucent}, ${platformScopes.dark.green.bgInteractiveSecondaryTranslucent})`,
      `light-dark(${platformScopes.light.red.bgInteractiveSecondaryTranslucent}, ${platformScopes.dark.red.bgInteractiveSecondaryTranslucent})`,
      `light-dark(${platformScopes.light.green.bgInteractivePrimaryTranslucent}, ${platformScopes.dark.green.bgInteractivePrimaryTranslucent})`,
      `light-dark(${platformScopes.light.red.bgInteractivePrimaryTranslucent}, ${platformScopes.dark.red.bgInteractivePrimaryTranslucent})`,
    ),
  );

  return (
    <div
      ref={ref}
      className={`${themed.className ?? ""} ${className}`}
      style={themed.style}
      dangerouslySetInnerHTML={{ __html: `<template shadowrootmode="open">${html}</template>` }}
      suppressHydrationWarning
    />
  );
}

const styles = create({
  host: {
    "--diffs-light": role.contentPrimary,
    "--diffs-dark": role.contentPrimary,
    "--diffs-bg-buffer-override": role.bgBase,
    "--diffs-bg-context-override": role.bgBase,
    "--diffs-bg-context-gutter-override": role.bgBase,
  },
  palette: (
    addition: string,
    deletion: string,
    additionEmphasis: string,
    deletionEmphasis: string,
  ) => ({
    "--diffs-bg-addition-override": addition,
    "--diffs-bg-deletion-override": deletion,
    "--diffs-bg-addition-emphasis-override": additionEmphasis,
    "--diffs-bg-deletion-emphasis-override": deletionEmphasis,
  }),
});
