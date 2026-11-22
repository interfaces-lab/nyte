import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compile } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { ServerSpec } from "../spec.ts";
import packages from "./typescript-language-server.lock.json" with { type: "json" };

const PackageManifest = compile(Type.Object({ version: Type.String() }));

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

export const TYPESCRIPT_LANGUAGE_SERVER: ServerSpec = {
  name: "typescript-language-server",
  languages: ["typescript"],
  rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
  requiresRootMarker: false,
  program: "typescript-language-server",
  arguments: ["--stdio"],
  install: {
    kind: "npm",
    version: "6.1.0",
    packages,
    entry: "node_modules/typescript-language-server/lib/cli.mjs",
  },
  runtime: null,
  installHint:
    "Install the TypeScript language server: npm install -g typescript-language-server typescript",
  initializationOptions: { preferences: PREFERENCES },
  settings: { typescript: LANGUAGE, javascript: LANGUAGE },
  async prepare(root) {
    const typescript = await findUpward(root, join("node_modules", "typescript"));

    const manifest =
      typescript === null
        ? null
        : await readFile(join(typescript, "package.json"), "utf8").catch(() => null);

    const version = manifest === null ? null : readPackageVersion(manifest);

    return {
      initializationOptions: {
        preferences: PREFERENCES,
        ...(typescript === null || version === null
          ? {}
          : { tsserver: { path: join(typescript, "lib", "tsserver.js") } }),
      },
      runsOn: version === null ? null : `TypeScript ${version}`,
    };
  },
};

async function findUpward(from: string, name: string): Promise<string | null> {
  const candidate = join(from, name);

  if ((await stat(candidate).catch(() => null)) !== null) return candidate;
  const parent = dirname(from);

  return parent === from ? null : findUpward(parent, name);
}

function readPackageVersion(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text);

    return PackageManifest.Check(value) ? value.version : null;
  } catch {
    return null;
  }
}
