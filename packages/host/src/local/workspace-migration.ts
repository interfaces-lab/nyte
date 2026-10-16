import { realpath, stat } from "node:fs/promises";
import { SdkError, decodeWorkspaceRecord, envelope } from "@nyte-ai/core";
import type { StoreConnection } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import type { RefUpdate } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { sha256 } from "../hash.ts";

const MIGRATION = "host/migrations/local-workspace-identity-v2";

const MigrationState = Type.Object({ pending: Type.Array(Type.String()) });

export async function migrateLocalWorkspaceIdentities(connection: StoreConnection): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const marker = await connection.refs.get(MIGRATION);
    const state = marker?.target == null ? null : await connection.objects.get(marker.target);
    const pending = Value.Check(MigrationState, state) ? state.pending : null;

    if (marker !== null && pending === null)
      throw new SdkError("internal", "The workspace identity migration state is malformed.");

    if (pending?.length === 0) return;

    const refs =
      pending === null
        ? await connection.refs.list("workspaces/")
        : await Promise.all(pending.map((name) => connection.refs.get(name)));

    const updates: RefUpdate[] = [];
    const remaining: string[] = [];

    for (const ref of refs) {
      if (ref === null) continue;

      const record = decodeWorkspaceRecord(
        ref.target === null ? null : await connection.objects.get(ref.target),
      );

      if (record?.target.kind !== "local" || !("path" in record.target)) continue;
      const real = await realpath(record.target.path).catch(() => null);

      if (real === null) {
        remaining.push(ref.name);
        continue;
      }

      const metadata = await stat(real, { bigint: true }).catch(() => null);

      if (metadata === null) {
        remaining.push(ref.name);
        continue;
      }

      if (
        !metadata.isDirectory() ||
        metadata.ino === 0n ||
        metadata.birthtimeNs === 0n ||
        metadata.birthtimeNs / 1_000_000n > BigInt(Math.floor(record.createdAt)) ||
        record.identity !== sha256(`${metadata.dev}:${metadata.ino}`)
      )
        continue;

      const identity = asId<"environment-identity">(
        sha256(`${metadata.birthtimeNs}:${metadata.ino}`),
      );

      updates.push({
        name: ref.name,
        expect: ref.revision,
        target: await connection.objects.put(
          envelope("workspace", { ...record, identity }, Date.now()),
        ),
      });
    }

    if (
      updates.length === 0 &&
      pending !== null &&
      pending.length === remaining.length &&
      remaining.every((name, index) => pending[index] === name)
    )
      return;

    updates.push({
      name: MIGRATION,
      expect: marker?.revision ?? "absent",
      target: await connection.objects.put({ pending: remaining }),
    });

    if ((await connection.refs.set(updates)).kind === "set") return;
  }

  throw new SdkError("unavailable", "Workspace identities changed while Nyte was updating them.");
}
