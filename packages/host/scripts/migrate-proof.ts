import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { asId } from "@nyte-ai/schema";
import { chatOnly, fakeModels } from "../test/fixtures/fake-models.ts";
import { openHost } from "../src/open.ts";
import { sqliteStore } from "../src/sqlite.ts";
import { MAPPING } from "../test/migration/mapping.ts";
import { verifyMigration } from "../test/migration/verify.ts";

const source = resolve(process.argv[2] ?? join(homedir(), ".nyte", "nyte.db"));

const work = resolve(process.argv[3] ?? mkdtempSync(join(tmpdir(), "nyte-migrate-proof-")));

mkdirSync(work, { recursive: true });

const beforePath = join(work, "before.db");

const storePath = join(work, "store.db");

const reader = new DatabaseSync(source, { readOnly: true });

await backup(reader, beforePath);

reader.close();

const pristine = new DatabaseSync(beforePath, { readOnly: true });

await backup(pristine, storePath);

pristine.close();

const migrating = performance.now();

const store = sqliteStore({ path: storePath });

await store.open();

await store.close();

const migrationMs = Math.round(performance.now() - migrating);

const report = await verifyMigration(beforePath, storePath);

const problems = [...report.problems];

const folding = performance.now();

const hostStore = sqliteStore({ path: storePath });

const sessions = (await (await hostStore.open()).refs.list("sessions/")).flatMap((ref) => {
  const [, id, rest] = ref.name.split("/");

  return id !== undefined && rest === undefined ? [id] : [];
});

const home = join(work, "home");

mkdirSync(home, { recursive: true });

const host = await openHost({
  home,
  store: hostStore,
  models: fakeModels().models,
  plugins: [chatOnly],
  workspace: { kind: "chat-only", locator: null },
  execution: { kind: "admit-only" },
});

const listed = await host.sessions.list({ parents: { kind: "all" }, limit: sessions.length + 10 });

let heads = 0;

let messages = 0;

let turns = 0;

for (const id of sessions) {
  try {
    const session = host.session(asId<"session">(id));

    for (const head of (await session.info()).heads) {
      const view = await session.head(head.name).view({ tail: Number.MAX_SAFE_INTEGER });
      heads += 1;
      messages += view.messages.length;
      turns += view.turns.length;
    }
  } catch (error) {
    problems.push(
      `session ${id} does not fold: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

await host.close();

await hostStore.close();

if (listed.items.length !== sessions.length)
  problems.push(`sessions.list shows ${listed.items.length} of ${sessions.length} sessions`);

const result = {
  source,
  work,
  migrationMs,
  ...report,
  fold: {
    sessions: sessions.length,
    listed: listed.items.length,
    heads,
    messages,
    turns,
    ms: Math.round(performance.now() - folding),
  },
  mapping: MAPPING.filter((row) => row.version > report.from),
  problems: problems.slice(0, 100),
  problemCount: problems.length,
};

writeFileSync(join(work, "report.json"), `${JSON.stringify(result, null, 2)}\n`);

console.log(JSON.stringify(result, null, 2));

process.exitCode = problems.length === 0 ? 0 : 1;
