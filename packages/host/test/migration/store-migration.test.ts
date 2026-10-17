import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import fc from "fast-check";
import { afterAll, expect, it } from "vitest";
import { STORE_VERSION } from "@nyte-ai/core/store";
import { sqliteStore } from "../../src/sqlite.ts";
import { MAPPING } from "./mapping.ts";
import { scenario, writeStore } from "./scenario.ts";
import { verifyMigration } from "./verify.ts";

const RUNS = Number(process.env.NYTE_MIGRATION_RUNS ?? 1_000);

const SEED = Number(process.env.NYTE_MIGRATION_SEED ?? Date.now() % 2_147_483_647);

const totals = new Map<string, number>();

function tally(key: string, by: number): void {
  totals.set(key, (totals.get(key) ?? 0) + by);
}

afterAll(() => {
  const summary = {
    seed: SEED,
    runs: RUNS,
    storeVersion: STORE_VERSION,
    totals: Object.fromEntries([...totals].sort(([left], [right]) => left.localeCompare(right))),
  };

  console.log(`store migration property: ${JSON.stringify(summary)}`);

  if (process.env.NYTE_MIGRATION_REPORT !== undefined)
    writeFileSync(
      process.env.NYTE_MIGRATION_REPORT,
      `${JSON.stringify({ ...summary, mapping: MAPPING }, null, 2)}\n`,
    );
});

it(
  "migrates every store an older Nyte could have written to exactly what MAPPING says, losing nothing",
  { timeout: 1_800_000 },
  async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (input) => {
        const folder = mkdtempSync(join(tmpdir(), "nyte-migration-"));

        try {
          const path = join(folder, "store.db");
          const beforePath = join(folder, "before.db");
          await writeStore(path, input);
          const source = new DatabaseSync(path, { readOnly: true });
          await backup(source, beforePath);
          source.close();
          const store = sqliteStore({ path });
          await store.open();
          await store.close();
          const report = await verifyMigration(beforePath, path);

          expect(report.problems).toEqual([]);
          tally(`from ${report.from}`, 1);
          tally("refs checked", report.refs.before);
          tally("events checked", report.log.events);
          tally("events relogged", report.log.relogged);

          for (const [key, value] of Object.entries(report.refs.outcomes))
            tally(`refs ${key}`, value);

          for (const [key, value] of Object.entries(report.refs.added))
            tally(`added ${key}`, value);

          for (const [key, value] of Object.entries(report.fieldChanges))
            tally(`field ${key}`, value);

          for (const [key, value] of Object.entries(report.hookDecisions))
            tally(`hook decisions ${key}`, value);
        } finally {
          rmSync(folder, { recursive: true, force: true });
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );

    for (const covered of MAPPING.flatMap((row) => row.covers)) {
      const counted = [...totals].filter(
        ([key]) =>
          key === covered || key.replace(/^field call\/\w+ /u, "field call/* ") === covered,
      );

      expect(
        counted.reduce((sum, [, value]) => sum + value, 0),
        covered,
      ).toBeGreaterThan(0);
    }
  },
);
