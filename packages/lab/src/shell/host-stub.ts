import type { VcsDiff, VcsSnapshot } from "@nyte-ai/protocol";
import type { HostState, NyteBridge } from "@nyte-ai/app/bridge.ts";
import { installBridge } from "@nyte-ai/app/nyte.ts";

/*
 * `theme/boot.ts` reads the bridge while its module evaluates, so the fixture
 * has to be installed before anything that imports it loads. Import this
 * first.
 *
 * The few reads the real workbench needs answer with fixture data; every
 * other call rejects, so a panel with no fixture shows its own failed state.
 */
export const workspace = { path: "/Users/lab/nyte", name: "nyte", lastOpenedAt: 0 } as const;

const host = { workspace, platform: "darwin" } satisfies HostState;

const diffs = [
  {
    path: "packages/lab/src/tokens/shadow.css",
    status: "added",
    kind: "text",
    added: 6,
    removed: 0,
    patch: [
      "diff --git a/packages/lab/src/tokens/shadow.css b/packages/lab/src/tokens/shadow.css",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/packages/lab/src/tokens/shadow.css",
      "@@ -0,0 +1,6 @@",
      "+:root {",
      "+  --lab-shadow-depth: 1;",
      "+  --nyte-shadow-popover: 0 calc(4px * var(--lab-shadow-depth))",
      "+    calc(12px * var(--lab-shadow-depth)) -2px var(--nyte-shadow-tertiary);",
      "+  --nyte-shadow-modal: var(--nyte-box-shadow-lg);",
      "+}",
      "",
    ].join("\n"),
  },
  {
    path: "packages/desktop/src/renderer/src/theme/floating-surface.stylex.ts",
    status: "modified",
    kind: "text",
    added: 4,
    removed: 2,
    patch: [
      "diff --git a/packages/desktop/src/renderer/src/theme/floating-surface.stylex.ts b/packages/desktop/src/renderer/src/theme/floating-surface.stylex.ts",
      "--- a/packages/desktop/src/renderer/src/theme/floating-surface.stylex.ts",
      "+++ b/packages/desktop/src/renderer/src/theme/floating-surface.stylex.ts",
      "@@ -8,7 +8,9 @@ export const floatingSurfaceStyles = create({",
      "   popup: {",
      '     position: "relative",',
      "-    borderRadius: 14,",
      "-    backgroundColor: t.bgRaised,",
      "+    borderRadius: t.radiusMenu,",
      "+    backgroundColor: t.materialFill,",
      "+    backdropFilter: t.materialEffect,",
      '+    backgroundClip: "padding-box",',
      "     boxShadow: t.shadowPopover,",
      "     color: t.textPrimary,",
      '     outline: "none",',
      "",
    ].join("\n"),
  },
  {
    path: "packages/lab/src/shell/workbench-demo.tsx",
    status: "deleted",
    kind: "text",
    added: 0,
    removed: 3,
    patch: [
      "diff --git a/packages/lab/src/shell/workbench-demo.tsx b/packages/lab/src/shell/workbench-demo.tsx",
      "deleted file mode 100644",
      "--- a/packages/lab/src/shell/workbench-demo.tsx",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      '-import { create, props } from "@stylexjs/stylex";',
      '-import { Button } from "@nyte-ai/ui";',
      '-import { useState } from "react";',
      "",
    ].join("\n"),
  },
] satisfies VcsDiff[];

const vcs = {
  kind: "repository",
  root: workspace.path,
  revision: "lab",
  head: {
    kind: "attached",
    oid: "8995cb2",
    branch: "main",
    upstream: { name: "origin/main", ahead: 1, behind: 0 },
    base: null,
  },
  staged: [],
  unstaged: [
    {
      path: "packages/desktop/src/renderer/src/theme/floating-surface.stylex.ts",
      kind: "modified",
    },
    { path: "packages/lab/src/shell/workbench-demo.tsx", kind: "deleted" },
    { path: "packages/lab/src/tokens/shadow.css", kind: "untracked" },
  ],
} satisfies VcsSnapshot;

const answers = new Map<string, unknown>([
  ["host.state", host],
  ["workspace.vcs.snapshot", vcs],
  ["workspace.vcs.diff", diffs],
  ["host.setThemePreference", undefined],
]);

function bridge(path: string): () => void {
  return new Proxy(function host() {}, {
    get: (_target, key) =>
      key === "then" ? undefined : bridge(path === "" ? String(key) : `${path}.${String(key)}`),
    apply: () => {
      if (/(^|\.)(on[A-Z]\w*|watch)$/.test(path)) return () => {};

      return answers.has(path)
        ? Promise.resolve(answers.get(path))
        : Promise.reject(new Error(`The lab has no host for ${path}`));
    },
  });
}

declare global {
  interface Window {
    readonly nyte: NyteBridge;
  }
}

Object.defineProperty(window, "nyte", { value: bridge(""), configurable: true });
installBridge(window.nyte);
