/**
 * The desktop's plugin composition, mirroring the TUI host's: the same
 * built-ins, the same `~/.nyte` and `<cwd>/.nyte` directories, the same
 * manifest. Trust is the argument: `resolveDesktopPlugins` takes a
 * `TrustedWorkspace`, a value that exists only after the trust gate
 * (invariant 21), so project code cannot load before the grant.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type, Unsafe } from "typebox";
import { Compile } from "typebox/compile";
import { FileCredentialStore } from "@nyte-ai/ai";
import type { Api, Model, Models } from "@nyte-ai/ai";
import { resolvePlugins } from "@nyte-ai/core";
import type {
  PluginDirectory,
  PluginManifest,
  ResolvedPlugins,
  TrustedWorkspace,
} from "@nyte-ai/core";
import type { JsonValue } from "@nyte-ai/schema";
import { fastModePlugin } from "@nyte-ai/plugin/examples/fast-mode";
import { openaiCompactionPlugin } from "@nyte-ai/plugin/openai-compaction";
import { renamePlugin } from "@nyte-ai/plugin/examples/rename";
import {
  webSearchCredentialId,
  webSearchPlugins,
  type WebSearchCredentials,
} from "@nyte-ai/plugin/examples/web-search";
import {
  SKILLS_PLUGIN_ID,
  contextFilesPlugin,
  skillsPlugin,
  stockAgentsPlugin,
  systemPromptPlugin,
  toolsFsPlugin,
} from "@nyte-ai/core/plugins";
import { errorCode } from "./errors.ts";

/** A new generation per resolve, so re-opening a workspace re-scans skills. */
let skillsGeneration = 0;

export type DesktopPluginTarget =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly workspace: TrustedWorkspace };

export async function resolveDesktopPlugins(
  target: DesktopPluginTarget,
  context: { model: Model<Api>; models: Models },
): Promise<ResolvedPlugins> {
  const cwd = target.kind === "project" ? target.workspace.cwd : undefined;
  return resolvePlugins({
    builtins: [
      systemPromptPlugin(),
      renamePlugin({ models: context.models, model: context.model }),
      contextFilesPlugin({ globalDir: join(homedir(), ".nyte") }),
      toolsFsPlugin(),
      openaiCompactionPlugin({ models: context.models }),
      fastModePlugin({ models: context.models, defaultModel: context.model }),
      // The tool first, then the provider plugins that join it.
      ...webSearchPlugins({ credentials: webSearchCredentials() }),
      skillsPlugin({ directories: skillDirectories(target) }),
      stockAgentsPlugin(),
    ],
    directories: pluginDirectories(target),
    manifest: cwd === undefined ? undefined : await readManifest(cwd),
    builtinVersions: { [SKILLS_PLUGIN_ID]: `builtin:${String(++skillsGeneration)}` },
  });
}

function pluginDirectories(target: DesktopPluginTarget): PluginDirectory[] {
  const user = { path: join(homedir(), ".nyte", "plugins"), source: "user" } as const;
  if (target.kind === "home") return [user];
  return [user, { path: join(target.workspace.cwd, ".nyte", "plugins"), source: "project" }];
}

/** Project skills override user skills; Nyte-native locations win over compatibility locations. */
function skillDirectories(target: DesktopPluginTarget): string[] {
  const user = [
    join(homedir(), ".nyte", "skills"),
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".claude", "skills"),
  ];
  if (target.kind === "home") return user;
  const cwd = target.workspace.cwd;
  return [
    join(cwd, ".nyte", "skills"),
    join(cwd, ".agents", "skills"),
    join(cwd, ".claude", "skills"),
    ...user,
  ];
}

function webSearchCredentials(): WebSearchCredentials {
  const store = new FileCredentialStore();
  return {
    async read(provider) {
      const credential = await store.read(webSearchCredentialId(provider));
      return credential?.type === "api_key" ? credential.key : undefined;
    },
    async write(provider, key) {
      const id = webSearchCredentialId(provider);
      if (key === undefined) {
        await store.delete(id);
        return;
      }
      await store.modify(id, () => Promise.resolve({ type: "api_key", key }));
    },
  };
}

/** `.nyte/nyte.json` in the project; optional. Disables ids and sets options, never lists plugins. */
const manifestFile = Compile(
  Type.Object(
    {
      plugins: Type.Optional(
        Type.Array(
          Type.Union([
            Type.String(),
            Type.Object(
              // `JSON.parse` output is JSON by construction.
              { id: Type.String(), options: Type.Optional(Unsafe<JsonValue>({})) },
              { additionalProperties: false },
            ),
          ]),
        ),
      ),
    },
    { additionalProperties: false },
  ),
);

async function readManifest(cwd: string): Promise<PluginManifest | undefined> {
  let text: string;
  try {
    text = await readFile(join(cwd, ".nyte", "nyte.json"), "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (manifestFile.Check(parsed)) return parsed;
  const problems = manifestFile
    .Errors(parsed)
    .map((error) => `${error.instancePath || "/"}: ${error.message}`);
  throw new Error(`.nyte/nyte.json: ${problems.join("; ")}`);
}
