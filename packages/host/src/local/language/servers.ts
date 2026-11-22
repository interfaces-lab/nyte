import { stat } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { findLanguage } from "@nyte-ai/schema";
import { GOPLS } from "./servers/gopls.ts";
import { OXLINT } from "./servers/oxlint.ts";
import { RUFF } from "./servers/ruff.ts";
import { TYPESCRIPT_LANGUAGE_SERVER } from "./servers/typescript-language-server.ts";
import type { ServerSpec } from "./spec.ts";

export const SERVERS: readonly ServerSpec[] = [GOPLS, RUFF, TYPESCRIPT_LANGUAGE_SERVER, OXLINT];

export async function findServers(
  path: string,
  workspace: string,
): Promise<{
  readonly languageId: string;
  readonly servers: readonly { readonly spec: ServerSpec; readonly root: string }[];
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
  spec: ServerSpec,
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
