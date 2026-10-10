import { Type } from "typebox";
import type { Configuration, ConfigurationPatch } from "../configuration.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { JsonType, withJson } from "./json.ts";
import { ModelRefType, ThinkingType } from "./models.ts";
import { nullable } from "./nullable.ts";

/** The TypeBox schema of a `ConfigurationPatch`. */
export const ConfigurationPatchType = Type.Object({
  model: Type.Optional(ModelRefType),
  thinking: Type.Optional(nullable(ThinkingType)),
  agent: Type.Optional(nullable(Type.String())),
  settings: Type.Optional(Type.Record(Type.String(), JsonType)),
});

/** The TypeBox schema of a `Configuration`. */
export const ConfigurationType = Type.Object({
  kind: Type.Literal("exact"),
  model: ModelRefType,
  thinking: ThinkingType,
  agent: nullable(Type.String()),
  settings: Type.Record(Type.String(), JsonType),
  settingsVersion: Type.String(),
});

/** Validates a `ConfigurationPatch`. */
export const ConfigurationPatchSchema: Schema<ConfigurationPatch> = standard(
  withJson(ConfigurationPatchType),
);

/** Validates a `Configuration`. */
export const ConfigurationSchema: Schema<Configuration> = standard(withJson(ConfigurationType));
