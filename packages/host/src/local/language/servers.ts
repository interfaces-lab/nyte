import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, sep } from "node:path";
import { compile } from "@nyte-ai/schema";
import type { Json, LanguageName } from "@nyte-ai/schema";
import { Type } from "typebox";

const PackageManifest = compile(Type.Object({ version: Type.String() }));

/** How to find, start and configure one language server. */
export type ServerSpec = {
  readonly language: LanguageName;
  readonly program: string;
  readonly arguments: readonly string[];
  readonly languageIds: Readonly<Record<string, string>>;
  readonly markers: readonly string[];
  readonly hint: string;
  readonly settings: Json;
  /** The initialization options for a server at `root`, and what it runs on when the server does not say, such as the TypeScript it found. */
  prepare(root: string): Promise<{ readonly options: Json; readonly runsOn: string | null }>;
};

const GO_OPTIONS = {
  usePlaceholders: false,
  completeUnimported: true,
  staticcheck: true,
  semanticTokens: true,
  hints: { parameterNames: true, constantValues: true },
  analyses: { nilness: true, unusedparams: true, unusedwrite: true, shadow: true, useany: true },
} as const;

const TYPESCRIPT_PREFERENCES = {
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

const TYPESCRIPT_LANGUAGE = {
  inlayHints: {
    parameterNames: { enabled: "literals", suppressWhenArgumentMatchesName: true },
    parameterTypes: { enabled: true },
    enumMemberValues: { enabled: true },
    ...TYPESCRIPT_PREFERENCES,
  },
  suggest: { completeFunctionCalls: false },
} as const;

export const SERVERS: readonly ServerSpec[] = [
  {
    language: "go",
    program: "gopls",
    arguments: [],
    languageIds: { ".go": "go" },
    markers: ["go.work", "go.mod"],
    hint: "Install gopls: go install golang.org/x/tools/gopls@latest",
    settings: { gopls: GO_OPTIONS },
    prepare: async () => ({ options: GO_OPTIONS, runsOn: null }),
  },
  {
    language: "typescript",
    program: "typescript-language-server",
    arguments: ["--stdio"],
    languageIds: {
      ".ts": "typescript",
      ".mts": "typescript",
      ".cts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".jsx": "javascriptreact",
    },
    markers: ["tsconfig.json", "jsconfig.json", "package.json"],
    hint: "Install the TypeScript language server: npm install -g typescript-language-server typescript",
    settings: { typescript: TYPESCRIPT_LANGUAGE, javascript: TYPESCRIPT_LANGUAGE },
    async prepare(root) {
      const typescript = await findUpward(root, join("node_modules", "typescript"));

      const manifest =
        typescript === null
          ? null
          : await readFile(join(typescript, "package.json"), "utf8").catch(() => null);

      const version = manifest === null ? null : readPackageVersion(manifest);

      return {
        options: {
          preferences: TYPESCRIPT_PREFERENCES,
          ...(typescript === null || version === null
            ? {}
            : { tsserver: { path: join(typescript, "lib", "tsserver.js") } }),
        },
        runsOn: version === null ? null : `TypeScript ${version}`,
      };
    },
  },
];

/** The server for `path` by its extension, with the language id LSP knows the file by. */
export function findServer(
  path: string,
): { readonly spec: ServerSpec; readonly languageId: string } | null {
  const extension = extname(path).toLowerCase();

  for (const spec of SERVERS) {
    const languageId = spec.languageIds[extension];

    if (languageId !== undefined) return { spec, languageId };
  }

  return null;
}

/** The nearest folder from the file's up to `workspace` holding one of the spec's markers; `workspace` when none does. */
export async function findProjectRoot(
  spec: ServerSpec,
  path: string,
  workspace: string,
): Promise<string> {
  for (
    let folder = dirname(path);
    folder.startsWith(`${workspace}${sep}`);
    folder = dirname(folder)
  )
    for (const marker of spec.markers)
      if ((await stat(join(folder, marker)).catch(() => null)) !== null) return folder;

  return workspace;
}

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
