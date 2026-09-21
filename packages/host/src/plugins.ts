import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Type, Unsafe } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import { FileCredentialStore } from "@nyte-ai/ai";
import type { MutableModels } from "@nyte-ai/ai";
import { resolvePlugins } from "@nyte-ai/core";
import type { ResolvedPlugins } from "@nyte-ai/core";
import type { Api, JsonValue, Model } from "@nyte-ai/schema";
import {
  SKILLS_PLUGIN_ID,
  contextFilesPlugin,
  loadSkills,
  skillsPlugin,
  systemPromptPlugin,
  toolsFsPlugin,
} from "@nyte-ai/core/plugins";
import type { Plugin } from "@nyte-ai/core/plugins";
import { fastModePlugin } from "@nyte-ai/plugin/examples/fast-mode";
import { openaiCompactionPlugin } from "@nyte-ai/plugin/openai-compaction";
import { openaiAstraContextPlugin } from "@nyte-ai/plugin/openai-astra-context";
import { renamePlugin } from "@nyte-ai/plugin/examples/rename";
import { warmingPlugin } from "@nyte-ai/plugin/examples/warming";
import { MCP_PLUGIN_ID, McpServerConfig, McpServers, mcpPlugin } from "@nyte-ai/plugin/mcp";
import { webSearchCredentialId, webSearchPlugins } from "@nyte-ai/plugin/examples/web-search";
import type { WebSearchCredentials } from "@nyte-ai/plugin/examples/web-search";
import { manifestPaths, nyteHome, pluginDirectories, skillDirectories } from "./paths.ts";
import type { PluginTarget } from "./paths.ts";

// MCP connections belong to the process: every session shares them, and a
// session reload that leaves a server's config alone keeps its connection.
const mcpServers = new McpServers();

export async function resolveHostPlugins(
  target: PluginTarget,
  context: {
    readonly models: MutableModels;
    readonly model: Model<Api>;
    readonly extra?: readonly Plugin[];
  },
): Promise<ResolvedPlugins> {
  const [manifest, skills] = await Promise.all([
    readManifest(target),
    loadSkills(skillDirectories(target)),
  ]);
  const mcp = manifest.mcp ?? {};
  return resolvePlugins({
    builtins: [
      systemPromptPlugin(),
      renamePlugin({ models: context.models, model: context.model }),
      contextFilesPlugin({ globalDir: nyteHome() }),
      toolsFsPlugin(),
      openaiCompactionPlugin({ models: context.models }),
      openaiAstraContextPlugin(),
      fastModePlugin({ models: context.models, defaultModel: context.model }),
      warmingPlugin({ models: context.models }),
      ...webSearchPlugins({ credentials: webSearchCredentials() }),
      mcpPlugin({ servers: mcpServers, config: mcp }),
      ...(context.extra ?? []),
      skillsPlugin(skills),
    ],
    directories: pluginDirectories(target),
    manifest,
    builtinVersions: {
      // Identity, not a counter: a rescan that finds the same skills leaves the plugin alone.
      [SKILLS_PLUGIN_ID]: `builtin:${digest(skills)}`,
      [MCP_PLUGIN_ID]: `builtin:${digest(mcp)}`,
    },
  });
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
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

const manifestSchema = Type.Object(
  {
    plugins: Type.Optional(
      Type.Array(
        Type.Union([
          Type.String(),
          Type.Object(
            // JSON.parse produces JSON values; plugin options keep their own schema boundary.
            { id: Type.String(), options: Type.Optional(Unsafe<JsonValue>({})) },
            { additionalProperties: false },
          ),
        ]),
      ),
    ),
    mcp: Type.Optional(Type.Record(Type.String({ minLength: 1 }), McpServerConfig)),
  },
  { additionalProperties: false },
);
const manifestFile = Compile(manifestSchema);
const missingFile = Type.Object({ code: Type.Literal("ENOENT") });

export type HostManifest = Static<typeof manifestSchema>;

/**
 * `nyte.json` under the home directory and under the project's `.nyte`,
 * merged: plugin entries concatenate, project servers replace same-named user
 * servers. A missing file contributes nothing; a malformed one throws.
 */
export async function readManifest(target: PluginTarget): Promise<HostManifest> {
  const files = await Promise.all(manifestPaths(target).map(readManifestFile));
  return files.reduce<HostManifest>(
    (merged, file) =>
      file === undefined
        ? merged
        : {
            ...(merged.plugins === undefined && file.plugins === undefined
              ? {}
              : { plugins: [...(merged.plugins ?? []), ...(file.plugins ?? [])] }),
            ...(merged.mcp === undefined && file.mcp === undefined
              ? {}
              : { mcp: { ...merged.mcp, ...file.mcp } }),
          },
    {},
  );
}

async function readManifestFile(path: string): Promise<HostManifest | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (Value.Check(missingFile, error)) return undefined;
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (manifestFile.Check(parsed)) return parsed;
    const problems = manifestFile
      .Errors(parsed)
      .map((error) => `${error.instancePath || "/"}: ${error.message}`);
    throw new Error(problems.join("; "));
  } catch (cause) {
    throw new Error(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
}
