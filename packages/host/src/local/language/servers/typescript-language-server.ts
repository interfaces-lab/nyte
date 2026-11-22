import { join } from "node:path";
import type { Install, Project, ServerSpec } from "../spec.ts";
import { findPackage, readPackage } from "./packages.ts";
import packages from "./typescript-language-server.lock.json" with { type: "json" };

const PREFERENCES = {
  includeInlayParameterNameHints: "literals",
  includeInlayParameterNameHintsWhenArgumentMatchesName: false,
  includeInlayFunctionParameterTypeHints: true,
  includeInlayVariableTypeHints: false,
  includeInlayPropertyDeclarationTypeHints: false,
  includeInlayFunctionLikeReturnTypeHints: false,
  includeInlayEnumMemberValueHints: true,
  includeCompletionsWithSnippetText: true,
  useLabelDetailsInCompletionEntries: true,
  completeFunctionCalls: false,
} as const;

const LANGUAGE = {
  inlayHints: {
    parameterNames: { enabled: "literals", suppressWhenArgumentMatchesName: true },
    parameterTypes: { enabled: true },
    enumMemberValues: { enabled: true },
    ...PREFERENCES,
  },
  suggest: { completeFunctionCalls: false },
} as const;

const INSTALL: Install = {
  kind: "npm",
  package: "typescript-language-server",
  version: "6.1.0",
  packages,
  entry: "node_modules/typescript-language-server/lib/cli.mjs",
};

export const TYPESCRIPT_LANGUAGE_SERVER: ServerSpec = {
  name: "typescript-language-server",
  languages: ["typescript"],
  rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
  program: "typescript-language-server",
  arguments: ["--stdio"],
  install: INSTALL,
  installHint:
    "Install the TypeScript language server: npm install -g typescript-language-server typescript",
  initializationOptions: { preferences: PREFERENCES, tsserver: { useSyntaxServer: "never" } },
  settings: { typescript: LANGUAGE, javascript: LANGUAGE },
  async prepare(project) {
    const typescript =
      (await findPackage(project.root, "typescript")) ?? (await findPinnedTypeScript(project));

    if (typescript === null) return {};

    return {
      initializationOptions: {
        preferences: PREFERENCES,
        tsserver: {
          path: join(typescript.folder, "lib", "tsserver.js"),
          useSyntaxServer: "never",
        },
      },
      runsOn: `TypeScript ${typescript.version}`,
    };
  },
};

async function findPinnedTypeScript(project: Project) {
  const installed = await project.install(INSTALL);

  return installed === null
    ? null
    : readPackage(join(installed.folder, "node_modules", "typescript"));
}
