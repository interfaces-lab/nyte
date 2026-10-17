import { Type } from "typebox";
import { JsonType, withJson } from "./json.ts";
import { ModelRefType, ThinkingType } from "./models.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

export const ConfigurationPatchType = Type.Object({
  model: Type.Optional(ModelRefType),
  thinking: Type.Optional(nullable(ThinkingType)),
  agent: Type.Optional(nullable(Type.String())),
  settings: Type.Optional(Type.Record(Type.String(), JsonType)),
});

export type ConfigurationPatch = Decoded<typeof ConfigurationPatchType>;

export const ConfigurationType = Type.Object({
  kind: Type.Literal("exact"),
  model: ModelRefType,
  thinking: ThinkingType,
  agent: nullable(Type.String()),
  settings: Type.Record(Type.String(), JsonType),
  settingsVersion: Type.String(),
});

export type Configuration = Decoded<typeof ConfigurationType>;

export const ConfigurationPatchSchema: Schema<ConfigurationPatch> = standard(
  withJson(ConfigurationPatchType),
);

export const ConfigurationSchema: Schema<Configuration> = standard(withJson(ConfigurationType));
