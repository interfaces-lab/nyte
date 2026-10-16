import { OPERATIONS } from "@nyte-ai/schema";
import type { Declaration } from "@nyte-ai/schema";

const rows: { readonly [name: string]: Declaration<unknown, unknown> } = OPERATIONS;

const encoder = new TextEncoder();

/** Returns the operations table's SHA-256 digest, the first 16 hex digits: it hashes each row's name, kind, access and wire schemas in table order, so two builds whose tables differ in any operation or schema get different digests. */
export async function operationsDigest(): Promise<string> {
  const table = Object.entries(rows).map(([name, row]) => [
    name,
    row.kind,
    row.authority,
    row.scope,
    row.capability ?? null,
    row.recovery ?? null,
    row.wait ?? null,
    row.input["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
    row.output["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
  ]);

  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(table)));

  return new Uint8Array(hash).toHex().slice(0, 16);
}
