export function binaryDefines(env: Readonly<Record<string, string | undefined>>) {
  return {
    "process.env.OPENTUI_LIBC": JSON.stringify(env["OPENTUI_LIBC"] ?? "glibc"),
    NYTE_BUILT_CONNECT_ORIGIN: JSON.stringify(env["NYTE_CONNECT_ORIGIN"] ?? ""),
  };
}

export const BINARY_ENTRYPOINTS = [
  "tui/src/index.ts",
  "tui/src/host-worker.ts",
  "tui/src/codemode-worker.ts",
  "tui/src/mermaid-worker.ts",
  "tui/src/image-worker.ts",
] as const;
