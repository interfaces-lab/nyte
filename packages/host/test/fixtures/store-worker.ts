import { RefUpdateSchema, asId, asSeq, isJson } from "@nyte-ai/schema";
import type { Json, RefUpdate } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import type { Store, StoreConnection } from "@nyte-ai/core";
import { Settings } from "typebox/system";
import { durableObjectStore } from "../../src/durable-object.ts";
import type { DurableObjectSql } from "../../src/durable-object.ts";
import { fromBase64, toBase64 } from "./base64.ts";

Settings.Set({ useAcceleration: false });

/** A Durable Object that holds one `durableObjectStore` over its own SQLite storage and answers one store call per request: `{ op, args }` in, `{ ok }` or `{ error: { code, message } }` out. */
export class StoreHost {
  readonly #store: Store;
  #connection: Promise<StoreConnection> | null = null;

  constructor(state: { readonly storage: DurableObjectSql }) {
    this.#store = durableObjectStore(state.storage);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const call: unknown = await request.json();

      if (typeof call !== "object" || call === null || !("op" in call) || !("args" in call))
        throw new SdkError("invalid", "Send { op, args }.");
      const { op, args } = call;

      if (typeof op !== "string" || !Array.isArray(args) || !args.every(isJson))
        throw new SdkError("invalid", "Send { op, args }.");
      this.#connection ??= this.#store.open();

      return Response.json({ ok: await answer(await this.#connection, op, args) });
    } catch (error) {
      return Response.json({
        error: {
          code: error instanceof SdkError ? error.code : "internal",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

/** Runs one store call on a connection and returns its answer as JSON. */
async function answer(
  connection: StoreConnection,
  op: string,
  args: readonly Json[],
): Promise<Json> {
  const [first, second, third] = args;

  const text = (value: Json | undefined): string => {
    if (typeof value !== "string") throw new SdkError("invalid", `${op} takes a string.`);

    return value;
  };

  const count = (value: Json | undefined): number => {
    if (typeof value !== "number") throw new SdkError("invalid", `${op} takes a number.`);

    return value;
  };

  switch (op) {
    case "put":
      return connection.objects.put(first ?? null);
    case "get":
      return connection.objects.get(asId(text(first)));
    case "putBlob": {
      const bytes = fromBase64(text(first));

      return connection.objects.putBlob(
        (async function* () {
          yield bytes;
        })(),
      );
    }

    case "blob": {
      const reader = await connection.objects.blob(asId(text(first)));

      if (reader === null) return null;
      const chunks: Uint8Array[] = [];

      for await (const chunk of reader.chunks()) chunks.push(chunk);

      return { size: reader.size, mime: reader.mime, bytes: toBase64(chunks) };
    }

    case "refs.get":
      return connection.refs.get(text(first));
    case "refs.list":
      return [...(await connection.refs.list(text(first)))];
    case "refs.set":
      return connection.refs.set(updatesOf(first));
    case "log":
      return [
        ...(await connection.refs.log(asId(text(first)), asSeq(count(second)), count(third))),
      ];
    case "tail":
      return connection.refs.tail(asId(text(first)));
    default:
      throw new SdkError("invalid", `No store call is named ${op}.`);
  }
}

/** Returns the ref updates a `refs.set` call carries, each validated as a `RefUpdate`. */
function updatesOf(value: Json | undefined): readonly RefUpdate[] {
  if (!Array.isArray(value)) throw new SdkError("invalid", "refs.set takes an array of updates.");

  return value.map((entry) => {
    const checked = RefUpdateSchema["~standard"].validate(entry);

    if (checked instanceof Promise || checked.issues !== undefined)
      throw new SdkError("invalid", "A ref update is malformed.");

    return checked.value;
  });
}

/** The Worker: sends each request to the `StoreHost` named by its `store` query parameter. */
export default {
  fetch(
    request: Request,
    env: {
      readonly STORE: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
    },
  ): Promise<Response> {
    const name = new URL(request.url).searchParams.get("store") ?? "default";

    return env.STORE.getByName(name).fetch(request);
  },
};
