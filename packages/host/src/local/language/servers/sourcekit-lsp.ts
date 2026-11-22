import type { ServerSpec } from "../spec.ts";

export const SOURCEKIT_LSP: ServerSpec = {
  name: "sourcekit-lsp",
  languages: ["swift"],
  rootMarkers: [
    "Package.swift",
    "buildServer.json",
    ".bsp",
    "compile_commands.json",
    "compile_flags.txt",
  ],
  program: "sourcekit-lsp",
  probe: ["--help"],
  installHint:
    "Install a Swift toolchain: Xcode or Command Line Tools on macOS, or from https://www.swift.org/install",
  initializationOptions: {
    backgroundIndexing: true,
    backgroundPreparationMode: "enabled",
  },
};
