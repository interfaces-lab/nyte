import { Type } from "typebox";
import type { TProperties, TSchema } from "typebox";
import type { Declaration } from "../../declaration.ts";
import { standard } from "../../schema.ts";
import { base64Bytes } from "../base64.ts";
import { idSchema } from "../../ids.ts";
import { withJson } from "../../json.ts";

/** Returns a group of operation rows, each a declaration of its schemas, kind and access. */
export type OperationRows = { readonly [name: string]: Declaration<unknown, unknown> };

export function wireSchema<T extends TSchema>(type: T) {
  return standard(withJson(type));
}

export function wireObject<P extends TProperties>(properties: P) {
  return wireSchema(Type.Object(properties));
}

export const SESSION = { session: idSchema<"session">() };

export const WORKSPACE = { workspace: idSchema<"workspace">() };

export const PATH = { ...WORKSPACE, path: Type.String() };

export const NOTHING = wireSchema(Type.Null());

export const BYTES = wireSchema(base64Bytes);

export const ON_SESSION = wireObject(SESSION);

export const ON_WORKSPACE = wireObject(WORKSPACE);

export const ON_PATH = wireObject(PATH);

export const RECEIPT_ID = wireObject({ receipt: idSchema<"receipt">() });
