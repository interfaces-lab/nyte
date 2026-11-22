import type { PluginCheckReport, Schema, ValidationIssue } from "@nyte-ai/schema";
import { resolveSetting } from "../contract/plugin.ts";
import type { Plugin } from "../contract/plugin.ts";
import { convertJsonSchema } from "../util/json-schema.ts";
import { readTint } from "../util/tint.ts";
import { RESERVED_PART_KINDS } from "./part-definitions.ts";

export interface Preflight {
  readonly plugin: Plugin<"core">;
  readonly issues: readonly ValidationIssue[];
  readonly ok: boolean;
}

const RESERVED_IDS: ReadonlySet<string> = new Set(["models", "settings"]);

export function checkPlugins(plugins: readonly Plugin<"core">[]): PluginCheckReport {
  return {
    plugins: preflight(plugins, []).map(({ plugin, issues, ok }) => ({
      kind: ok ? "activated" : "rejected",
      id: plugin.id,
      issues,
    })),
    collisions: collisions(plugins),
  };
}

export function preflight(
  plugins: readonly Plugin<"core">[],
  loaded: readonly Plugin<"core">[],
): readonly Preflight[] {
  const taken = new Set(loaded.map((plugin) => plugin.id));

  const providers = new Set(
    loaded.flatMap((plugin) => (plugin.environment === undefined ? [] : [plugin.environment.kind])),
  );

  return plugins.map((plugin) => {
    const issues: ValidationIssue[] = [];

    const error = (path: readonly (string | number)[], message: string): void => {
      issues.push({ severity: "error", path, message, source: { plugin: plugin.id } });
    };

    if (taken.has(plugin.id) || plugins.filter((other) => other.id === plugin.id).length > 1) {
      error(["id"], `More than one plugin is named ${plugin.id}.`);
    }

    if (RESERVED_IDS.has(plugin.id)) {
      error(["id"], `The plugin id ${plugin.id} is reserved for the host.`);
    }

    if (plugin.id.includes("/")) error(["id"], `The plugin id ${plugin.id} contains "/".`);

    for (const setting of plugin.contribute?.settings ?? []) {
      const color = "mode" in setting ? setting.mode?.color : undefined;

      if (color !== undefined && readTint(color) === undefined) {
        error(
          ["settings", setting.id, "mode", "color"],
          `${color} isn't a CSS colour. Write one such as #8b5cf6 or oklch(0.62 0.21 293).`,
        );
      }
    }

    const kind = plugin.environment?.kind;

    if (kind !== undefined && issues.length === 0) {
      if (providers.has(kind)) {
        error(["environment"], `Another plugin provides the ${kind} environment.`);
      } else providers.add(kind);
    }

    for (const { path, schema, direction } of listContributionSchemas(plugin)) {
      try {
        convertJsonSchema(schema, direction);
      } catch (thrown) {
        error(
          path,
          `This schema has no JSON Schema: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        );
      }
    }

    return { plugin, issues, ok: issues.length === 0 };
  });
}

function listContributionSchemas(plugin: Plugin<"core">): readonly {
  readonly path: readonly string[];
  readonly schema: Schema<unknown>;
  readonly direction: "input" | "output";
}[] {
  const declared = plugin.contribute;

  const at = (
    path: readonly string[],
    schema: Schema<unknown> | undefined,
    direction: "input" | "output",
  ) => (schema === undefined ? [] : [{ path, schema, direction }]);

  return [
    ...(declared?.tools ?? []).flatMap((tool) => [
      ...at(["tools", tool.name, "parameters"], tool.parameters, "input"),
      ...at(["tools", tool.name, "output"], tool.output, "output"),
    ]),
    ...(declared?.settings ?? []).flatMap((setting) =>
      at(["settings", setting.id], resolveSetting(setting).schema, "output"),
    ),
    ...(declared?.parts ?? []).flatMap((part) => [
      ...at(["parts", part.kind, "state"], part.state, "output"),
      ...Object.entries(part.actions).flatMap(([action, spec]) => [
        ...at(["parts", part.kind, action, "input"], spec.input, "input"),
        ...at(["parts", part.kind, action, "answer"], spec.input, "output"),
        ...at(["parts", part.kind, action, "output"], spec.output, "output"),
      ]),
    ]),
  ];
}

function collisions(plugins: readonly Plugin<"core">[]): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const claims = new Map<string, string>();

  const claim = (kind: string, key: string, owner: string): void => {
    const previous = claims.get(`${kind}/${key}`);

    if (previous === undefined || previous === owner) {
      claims.set(`${kind}/${key}`, owner);

      return;
    }

    issues.push({
      severity: "warning",
      path: [kind, key],
      message: `${key} from ${owner} collides with the one from ${previous}.`,
      source: { plugin: owner },
    });
  };

  for (const plugin of plugins) {
    const declared = plugin.contribute;

    if (plugin.provider !== undefined) claim("providers", plugin.provider.id, plugin.id);

    for (const tool of declared?.tools ?? []) claim("tools", tool.name, plugin.id);

    for (const setting of declared?.settings ?? []) claim("settings", setting.id, plugin.id);

    for (const command of declared?.commands ?? []) claim("commands", command.name, plugin.id);

    for (const part of declared?.parts ?? []) {
      if (RESERVED_PART_KINDS.has(part.kind)) issues.push(reservedKind(part.kind, plugin.id));
      else claim("parts", part.kind, plugin.id);
    }
  }

  return issues;
}

export function reservedKind(kind: string, owner: string): ValidationIssue {
  return {
    severity: "warning",
    path: ["parts", kind],
    message: `${kind} is a built-in part kind; ${owner}'s definition is ignored.`,
    source: { plugin: owner },
  };
}

export function takenKind(kind: string, owner: string, holder: string | null): ValidationIssue {
  return {
    severity: "warning",
    path: ["parts", kind],
    message: `${holder ?? "Another definition"} already registered the ${kind} part kind; ${owner}'s definition is ignored.`,
    source: { plugin: owner },
  };
}
