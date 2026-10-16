export function binaryDefines(
  env: Readonly<Record<string, string | undefined>>,
  code: string | undefined,
) {
  return {
    "process.env.OPENTUI_LIBC": JSON.stringify(env["OPENTUI_LIBC"] ?? "glibc"),
    NYTE_BUILT_CONNECT_ORIGIN: JSON.stringify(env["NYTE_CONNECT_ORIGIN"] ?? ""),
    NYTE_BUILT_CODE_ID: JSON.stringify(code ?? ""),
  };
}

/**
 * The compiled binary's bundles, relative to `packages/`. `index.ts` is the CLI and
 * never imports the host; `host-worker.ts` runs it on a thread for `serve` and
 * `service run`; the host starts `codemode-worker.ts`; the first mermaid diagram starts
 * `mermaid-worker.ts`. Each is bundled separately.
 */
export const BINARY_ENTRYPOINTS = [
  "tui/src/index.ts",
  "tui/src/host-worker.ts",
  "tui/src/codemode-worker.ts",
  "tui/src/mermaid-worker.ts",
] as const;
