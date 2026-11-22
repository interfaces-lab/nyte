import { compile } from "@nyte-ai/schema";
import { Type } from "typebox";
import { INSTALL_FOLDER } from "../spec.ts";
import type { ServerSpec } from "../spec.ts";

const VERSION = "v0.24.0";

const ReportedVersion = compile(Type.Object({ Version: Type.String() }));

const OPTIONS = {
  usePlaceholders: false,
  completeUnimported: true,
  staticcheck: true,
  semanticTokens: true,
  hints: { parameterNames: true, constantValues: true },
  analyses: { shadow: true },
} as const;

export const GOPLS: ServerSpec = {
  name: "gopls",
  languages: ["go"],
  rootMarkers: ["go.work", "go.mod"],
  requiresRootMarker: false,
  program: "gopls",
  probe: ["version"],
  arguments: [],
  install: {
    kind: "toolchain",
    package: "gopls",
    version: VERSION,
    program: "go",
    arguments: ["install", `golang.org/x/tools/gopls@${VERSION}`],
    env: { GOBIN: INSTALL_FOLDER },
    bin: "gopls",
  },
  runtime: null,
  installHint: "Install gopls: go install golang.org/x/tools/gopls@latest",
  initializationOptions: OPTIONS,
  settings: { gopls: OPTIONS },
  readVersion(reported) {
    try {
      const value: unknown = JSON.parse(reported);

      return ReportedVersion.Check(value) ? value.Version : null;
    } catch {
      return null;
    }
  },
};
