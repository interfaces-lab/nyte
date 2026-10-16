import { Type } from "typebox";
import type { Configuration, ConfigurationPatch } from "../configuration.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { JsonType, withJson } from "./json.ts";
import { ModelRefType, ThinkingType } from "./models.ts";
import { nullable } from "./nullable.ts";

export const ConfigurationPatchType = Type.Object({
  model: Type.Optional(ModelRefType),
  thinking: Type.Optional(nullable(ThinkingType)),
  agent: Type.Optional(nullable(Type.String())),
  settings: Type.Optional(Type.Record(Type.String(), JsonType)),
});

export const ConfigurationType = Type.Object({
  kind: Type.Literal("exact"),
  model: ModelRefType,
  thinking: ThinkingType,
  agent: nullable(Type.String()),
  settings: Type.Record(Type.String(), JsonType),
  settingsVersion: Type.String(),
});

export const ConfigurationPatchSchema: Schema<ConfigurationPatch> = standard(
  withJson(ConfigurationPatchType),
);

export const ConfigurationSchema: Schema<Configuration> = standard(withJson(ConfigurationType));
