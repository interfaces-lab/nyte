import { stat } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { findLanguage } from "@nyte-ai/schema";
import { BASH_LANGUAGE_SERVER } from "./servers/bash-language-server.ts";
import { CLANGD } from "./servers/clangd.ts";
import { GOPLS } from "./servers/gopls.ts";
import { MARKSMAN } from "./servers/marksman.ts";
import { OXLINT } from "./servers/oxlint.ts";
import { POSTGRES_LANGUAGE_SERVER } from "./servers/postgres-language-server.ts";
import { RUFF } from "./servers/ruff.ts";
import { RUST_ANALYZER } from "./servers/rust-analyzer.ts";
import { SOURCEKIT_LSP } from "./servers/sourcekit-lsp.ts";
import { TY } from "./servers/ty.ts";
import { TYPESCRIPT_LANGUAGE_SERVER } from "./servers/typescript-language-server.ts";
import { VSCODE_CSS_LANGUAGE_SERVER } from "./servers/vscode-css-language-server.ts";
import { VSCODE_ESLINT_LANGUAGE_SERVER } from "./servers/vscode-eslint-language-server.ts";
import { VSCODE_HTML_LANGUAGE_SERVER } from "./servers/vscode-html-language-server.ts";
import { VSCODE_JSON_LANGUAGE_SERVER } from "./servers/vscode-json-language-server.ts";
import { YAML_LANGUAGE_SERVER } from "./servers/yaml-language-server.ts";
import type { CompleteSpec } from "./spec.ts";

export const SERVERS: readonly CompleteSpec[] = [
  CLANGD,
  GOPLS,
  TY,
  RUFF,
  SOURCEKIT_LSP,
  RUST_ANALYZER,
  TYPESCRIPT_LANGUAGE_SERVER,
  VSCODE_ESLINT_LANGUAGE_SERVER,
  OXLINT,
  POSTGRES_LANGUAGE_SERVER,
  YAML_LANGUAGE_SERVER,
  BASH_LANGUAGE_SERVER,
  VSCODE_JSON_LANGUAGE_SERVER,
  VSCODE_CSS_LANGUAGE_SERVER,
  VSCODE_HTML_LANGUAGE_SERVER,
  MARKSMAN,
].map((spec) => ({
  requiresRootMarker: false,
  probe: ["--version"],
  arguments: [],
  install: null,
  runtime: null,
  initializationOptions: null,
  settings: {},
  ...spec,
}));

export async function findServers(
  path: string,
  workspace: string,
): Promise<{
  readonly languageId: string;
  readonly servers: readonly { readonly spec: CompleteSpec; readonly root: string }[];
} | null> {
  const language = findLanguage(path);

  if (language === null) return null;

  const servers = await Promise.all(
    SERVERS.filter((spec) => spec.languages.includes(language.name)).map(async (spec) => {
      const marked = await findMarkedFolder(spec, path, workspace);

      return marked === null && spec.requiresRootMarker
        ? []
        : [{ spec, root: marked ?? workspace }];
    }),
  );

  return { languageId: language.id, servers: servers.flat() };
}

async function findMarkedFolder(
  spec: CompleteSpec,
  path: string,
  workspace: string,
): Promise<string | null> {
  for (
    let folder = dirname(path);
    folder === workspace || folder.startsWith(`${workspace}${sep}`);
    folder = dirname(folder)
  ) {
    for (const marker of spec.rootMarkers) {
      if ((await stat(join(folder, marker)).catch(() => null)) !== null) return folder;
    }

    if (folder === workspace) return null;
  }

  return null;
}
