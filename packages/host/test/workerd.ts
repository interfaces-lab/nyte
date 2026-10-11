import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  RefSchema,
  SessionEventSchema,
  SetOutcomeSchema,
  asId,
  asSeq,
  isJson,
} from "@nyte-ai/schema";
import type { Json, Schema } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import type { Store } from "@nyte-ai/core";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { memoryReader } from "../src/store-rows.ts";
import { fromBase64, toBase64 } from "./fixtures/base64.ts";

/** Bundles a Worker module for workerd as one ES module: TypeScript compiled, every import inlined but `node:*` and `cloudflare:*`, which workerd provides under `nodejs_compat`. */
export async function bundle(entry: URL): Promise<string> {
  const built = await build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2023",
    mainFields: ["module", "main"],
    conditions: ["workerd", "worker", "browser"],
    external: ["node:*", "cloudflare:*"],
    write: false,
    logLevel: "silent",
  });

  const output = built.outputFiles[0];

  if (output === undefined) throw new Error(`esbuild produced nothing for ${entry.href}.`);

  return output.text;
}

/** Returns one binding a test Worker reads from its `env`: a Durable Object namespace over a class it exports, or a text value. */
export type TestBinding =
  | { readonly kind: "durable-object"; readonly className: string }
  | { readonly kind: "text"; readonly value: string };

/** Starts workerd through Miniflare on a bundled module as the Worker `test`, with the compatibility date and flags `wrangler.jsonc` deploys with; every `durable-object` binding's class is exported with SQLite storage. */
export async function startWorker(
  script: string,
  bindings: Readonly<Record<string, TestBinding>>,
): Promise<Miniflare> {
  const entries = Object.entries(bindings);

  const worker = new Miniflare({
    workers: [
      {
        config: {
          name: "test",
          compatibilityDate: await compatibilityDate(),
          compatibilityFlags: ["nodejs_compat"],
          manifest: {
            mainModule: "worker.js",
            modules: { "worker.js": { type: "esm", contents: script } },
          },
          env: Object.fromEntries(
            entries.map(([name, binding]) => [
              name,
              binding.kind === "text"
                ? { type: "text", value: binding.value }
                : { type: "durable-object", worker: "test", exportName: binding.className },
            ]),
          ),
          exports: Object.fromEntries(
            entries.flatMap(([, binding]) =>
              binding.kind === "durable-object"
                ? [[binding.className, { type: "durable-object", storage: "sqlite" }]]
                : [],
            ),
          ),
        },
      },
    ],
  });

  await worker.ready;

  return worker;
}

/** Returns the compatibility date `deploy/cloudflare/wrangler.jsonc` deploys with. */
async function compatibilityDate(): Promise<string> {
  const config = await readFile(
    new URL("../src/deploy/cloudflare/wrangler.jsonc", import.meta.url),
    "utf8",
  );

  const date = /"compatibility_date":\s*"([^"]+)"/.exec(config)?.[1];

  if (date === undefined) throw new Error("wrangler.jsonc sets no compatibility_date.");

  return date;
}

/** Returns a `Store` in this process whose every call runs in the `StoreHost` Durable Object named `name` inside workerd, its arguments and answers as JSON. */
export function remoteStore(worker: Miniflare, name: string): Store {
  const call = async (op: string, args: readonly Json[]): Promise<Json> => {
    const response = await worker.dispatchFetch(
      `http://store.test/?store=${encodeURIComponent(name)}`,
      { method: "POST", body: JSON.stringify({ op, args }) },
    );

    const body: unknown = await response.json();

    if (typeof body !== "object" || body === null) throw new Error(`${op} answered no object.`);

    if ("error" in body) {
      const error = body.error;

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        "message" in error &&
        typeof error.message === "string"
      )
        throw new SdkError(codeOf(error.code), error.message);

      throw new Error(`${op} failed.`);
    }

    if (!("ok" in body) || !isJson(body.ok)) throw new Error(`${op} answered no JSON.`);

    return body.ok;
  };

  const text = async (op: string, args: readonly Json[]): Promise<string> => {
    const value = await call(op, args);

    if (typeof value !== "string") throw new Error(`${op} answered no string.`);

    return value;
  };

  return {
    kind: "durable-object",
    async open() {
      return {
        objects: {
          put: async (object) => asId(await text("put", [object])),
          get: (id) => call("get", [id]),
          async putBlob(bytes) {
            const chunks: Uint8Array[] = [];

            for await (const chunk of bytes) chunks.push(chunk);

            return asId(await text("putBlob", [toBase64(chunks)]));
          },
          async blob(id) {
            const found = await call("blob", [id]);

            if (found === null) return null;

            if (typeof found !== "object" || !("bytes" in found) || typeof found.bytes !== "string")
              throw new Error("blob answered no bytes.");

            return memoryReader(fromBase64(found.bytes));
          },
        },
        refs: {
          async get(name) {
            const found = await call("refs.get", [name]);

            return found === null ? null : checked(RefSchema, found);
          },
          async list(prefix) {
            const found = await call("refs.list", [prefix]);

            return Array.isArray(found) ? found.map((ref) => checked(RefSchema, ref)) : [];
          },
          async set(updates) {
            return checked(SetOutcomeSchema, await call("refs.set", [updatesJson(updates)]));
          },
          async log(session, after, limit) {
            const found = await call("log", [session, after, limit]);

            return Array.isArray(found)
              ? found.map((event) => checked(SessionEventSchema, event))
              : [];
          },
          async tail(session) {
            const found = await call("tail", [session]);

            if (typeof found !== "number") throw new Error("tail answered no number.");

            return asSeq(found);
          },
        },
        close: async () => undefined,
      };
    },
    close: async () => undefined,
  };
}

/** Returns ref updates as the JSON a `refs.set` call carries. */
function updatesJson(
  updates: Parameters<Awaited<ReturnType<Store["open"]>>["refs"]["set"]>[0],
): Json {
  const value: unknown = JSON.parse(JSON.stringify(updates));

  if (!isJson(value)) throw new Error("Ref updates are not JSON.");

  return value;
}

/** Returns a value validated by a schema; throws when it does not hold one. */
function checked<T>(schema: Schema<T>, value: unknown): T {
  const result = schema["~standard"].validate(value);

  if (result instanceof Promise || result.issues !== undefined)
    throw new Error(`The worker answered a malformed value: ${JSON.stringify(value)}`);

  return result.value;
}

/** Returns the `SdkError` code a worker answered, `internal` for anything else. */
function codeOf(code: unknown): ConstructorParameters<typeof SdkError>[0] {
  switch (code) {
    case "unauthenticated":
    case "denied":
    case "unknown":
    case "invalid":
    case "stale":
    case "unavailable":
      return code;
    default:
      return "internal";
  }
}
