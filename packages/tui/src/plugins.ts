/**
 * The plugin set a workspace runs: the host's built-ins, then `~/.nyte/plugins`,
 * then `<cwd>/.nyte/plugins`, filtered and configured by `.nyte/nyte.json`.
 * Trust is the argument: a `TrustedWorkspace` exists only after the trust gate,
 * so project code cannot load before the grant.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { FileCredentialStore } from "@nyte-ai/ai";
import type { Api, Model, Models } from "@nyte-ai/ai";
import { resolvePlugins } from "@nyte-ai/core";
import type {
  PluginDirectory,
  PluginManifest,
  ResolvedPlugins,
  TrustedWorkspace,
} from "@nyte-ai/core";
import {
  SKILLS_PLUGIN_ID,
  contextFilesPlugin,
  skillsPlugin,
  stockAgentsPlugin,
  systemPromptPlugin,
  toolsFsPlugin,
} from "@nyte-ai/core/plugins";
import { toJsonValue } from "@nyte-ai/core/store";
import { fastModePlugin } from "@nyte-ai/plugin/examples/fast-mode";
import { openaiCompactionPlugin } from "@nyte-ai/plugin/openai-compaction";
import { notificationsPlugin } from "@nyte-ai/plugin/examples/notifications";
import { questionPlugin } from "@nyte-ai/plugin/examples/question";
import { renamePlugin } from "@nyte-ai/plugin/examples/rename";
import { warmingPlugin } from "@nyte-ai/plugin/examples/warming";
import {
  webSearchCredentialId,
  webSearchPlugins,
  type WebSearchCredentials,
} from "@nyte-ai/plugin/examples/web-search";
import type { JsonValue } from "@nyte-ai/schema";
import { isJsonArray, isJsonObject, isJsonString, isMissingFile } from "./json.ts";

let skillsGeneration = 0;

type ManifestPlugin = NonNullable<PluginManifest["plugins"]>[number];

function parseManifestPlugin(value: JsonValue, index: number): ManifestPlugin {
  if (isJsonString(value)) return value;
  const path = `.nyte/nyte.json.plugins[${String(index)}]`;
  if (!isJsonObject(value)) throw new Error(`${path} must be a string or object`);
  const unknown = Object.keys(value).find((key) => key !== "id" && key !== "options");
  if (unknown !== undefined) throw new Error(`${path} has unknown property "${unknown}"`);
  const id = value["id"];
  if (!isJsonString(id)) throw new Error(`${path}.id must be a string`);
  const options = value["options"];
  return options === undefined ? { id } : { id, options };
}

/** Parse the complete `.nyte/nyte.json` before it enters the plugin host. */
export function parsePluginManifest(value: JsonValue): PluginManifest {
  if (!isJsonObject(value)) throw new Error(".nyte/nyte.json must be an object");
  const unknown = Object.keys(value).find((key) => key !== "plugins");
  if (unknown !== undefined) throw new Error(`.nyte/nyte.json has unknown property "${unknown}"`);
  const plugins = value["plugins"];
  if (plugins === undefined) return {};
  if (!isJsonArray(plugins)) throw new Error(".nyte/nyte.json.plugins must be an array");
  return { plugins: plugins.map(parseManifestPlugin) };
}

/** `.nyte/nyte.json` in the project; optional. Disables ids and sets options, never lists plugins. */
async function readManifest(cwd: string): Promise<PluginManifest | undefined> {
  let text: string;
  try {
    text = await readFile(join(cwd, ".nyte", "nyte.json"), "utf8");
  } catch (cause) {
    if (isMissingFile(cause)) return undefined;
    throw cause;
  }
  return parsePluginManifest(toJsonValue(JSON.parse(text)));
}

/** Web-search API keys live beside provider credentials, under their own ids. */
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

export interface PluginContext {
  readonly model: Model<Api>;
  readonly models: Models;
}

/** Host plugins the TUI preinstalls before user and project overrides. */
function builtinPlugins(cwd: string, context: PluginContext) {
  return [
    systemPromptPlugin(),
    renamePlugin({ models: context.models, model: context.model }),
    contextFilesPlugin({ globalDir: join(homedir(), ".nyte") }),
    toolsFsPlugin(),
    openaiCompactionPlugin({ models: context.models }),
    fastModePlugin({ models: context.models, defaultModel: context.model }),
    warmingPlugin({ models: context.models }),
    // The tool first, then the provider plugins that join it.
    ...webSearchPlugins({ credentials: webSearchCredentials() }),
    // Attention comes from the event stream, not the shell.
    notificationsPlugin,
    // The question tool parks the run; the shell answers it through `runs.reply`.
    questionPlugin,
    skillsPlugin({ directories: skillDirectories(cwd) }),
    // The SDK turns these delegates into its host-wired `task` tool.
    stockAgentsPlugin(),
  ];
}

/** Built-ins, then `~/.nyte/plugins`, then `<cwd>/.nyte/plugins`. */
export async function resolveWorkspacePlugins(
  workspace: TrustedWorkspace,
  context: PluginContext,
): Promise<ResolvedPlugins> {
  const { cwd } = workspace;
  return resolvePlugins({
    builtins: builtinPlugins(cwd, context),
    directories: pluginDirectories(cwd),
    manifest: await readManifest(cwd),
    builtinVersions: { [SKILLS_PLUGIN_ID]: `builtin:${String(++skillsGeneration)}` },
  });
}

export function pluginDirectories(cwd: string): PluginDirectory[] {
  return [
    { path: join(homedir(), ".nyte", "plugins"), source: "user" },
    { path: join(cwd, ".nyte", "plugins"), source: "project" },
  ];
}

/** Project skills override user skills; Nyte-native locations win over compatibility locations. */
export function skillDirectories(cwd: string): string[] {
  return [
    join(cwd, ".nyte", "skills"),
    join(cwd, ".agents", "skills"),
    join(cwd, ".claude", "skills"),
    join(homedir(), ".nyte", "skills"),
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".claude", "skills"),
  ];
}
