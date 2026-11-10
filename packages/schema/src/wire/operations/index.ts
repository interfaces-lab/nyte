import { SdkError } from "../../errors.ts";
import type { OperationDescription } from "../../host.ts";
import { isJson, isJsonObject } from "../../json.ts";
import type { Json } from "../../json.ts";
import type { Schema } from "../../schema.ts";
import { BROWSER_OPERATIONS } from "./browser.ts";
import { DOCUMENT_OPERATIONS } from "./documents.ts";
import { EVENT_OPERATIONS } from "./events.ts";
import type { OperationRows } from "./fields.ts";
import { FILE_OPERATIONS } from "./files.ts";
import { GIT_OPERATIONS } from "./git.ts";
import { GITHUB_OPERATIONS } from "./github.ts";
import { HOST_OPERATIONS, MAINTENANCE_OPERATIONS } from "./host.ts";
import { SESSION_OPERATIONS } from "./session.ts";
import { WORKSPACE_OPERATIONS } from "./workspace.ts";

export const API_REVISION = 22;

export const API_MIN_REVISION = 17;

export const OPERATIONS = {
  ...HOST_OPERATIONS,
  ...EVENT_OPERATIONS,
  ...SESSION_OPERATIONS,
  ...WORKSPACE_OPERATIONS,
  ...FILE_OPERATIONS,
  ...DOCUMENT_OPERATIONS,
  ...GIT_OPERATIONS,
  ...GITHUB_OPERATIONS,
  ...BROWSER_OPERATIONS,
  ...MAINTENANCE_OPERATIONS,
};

const rows: OperationRows = OPERATIONS;

/** In table order, or in the order of `names`; an unknown name throws `SdkError("invalid")`. */
export function describeOperations(names?: readonly string[]): readonly OperationDescription[] {
  const picked = names ?? Object.keys(rows);
  const unknown = picked.filter((name) => !Object.hasOwn(rows, name));

  if (unknown.length > 0)
    throw new SdkError("invalid", `No operation is named ${unknown.join(", ")}.`);

  return picked.flatMap((name) => {
    const row = rows[name];

    if (row === undefined) return [];

    return [
      {
        name,
        summary: row.summary,
        kind: row.kind,
        authority: row.authority,
        scope: row.scope,
        capability: row.capability,
        local: row.local,
        input: wireJsonSchema(row.input),
        output: wireJsonSchema(row.output),
      },
    ];
  });
}

function wireJsonSchema(schema: Schema<unknown>): Json {
  const json = schema["~standard"].jsonSchema.input({ target: "draft-2020-12" });

  if (!isJson(json)) throw new TypeError("An operation's JSON Schema is not JSON.");

  return unwrapRoot(json);
}

function unwrapRoot(json: Json): Json {
  if (!isJsonObject(json) || json.$ref !== "Root" || !isJsonObject(json.$defs)) return json;
  const root = json.$defs.Root;
  const definition = json.$defs.Json;

  if (!isJsonObject(root) || definition === undefined) return json;
  const text = JSON.stringify(root);

  if (text.includes('"$ref":"Root"')) return json;
  const body = Object.fromEntries(Object.entries(root).filter(([key]) => key !== "$id"));
  const nested = isJsonObject(body.$defs) ? body.$defs : {};

  return text.includes('"$ref":"Json"')
    ? { ...body, $defs: { ...nested, Json: definition } }
    : body;
}
