import assert from "node:assert/strict";
import { FileModelsStore, createNyteModels } from "@nyte-ai/ai";
import { branch, SqliteStore } from "@nyte-ai/core/store";
import type { Session } from "@nyte-ai/core/store";
import { transcriptFromCommits } from "@nyte-ai/client";
import { createWorkspaceStore } from "@nyte-ai/host";
import { afterEach, test } from "vitest";
import { loadPersistedCatalog } from "../src/main/catalog.ts";
import { readLastWorkspace } from "../src/main/workspaces.ts";
import {
  DEFAULT_CATALOG_MODEL_COUNT,
  DESKTOP_BENCHMARK_EPOCH_MS,
  createDesktopBenchmarkFixture,
} from "./fixtures.ts";
import type { DesktopBenchmarkFixture } from "./fixtures.ts";

const fixtures: DesktopBenchmarkFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

async function readStringFact(session: Session, name: string): Promise<string> {
  const oid = await session.refs.read(name);
  if (oid === null) assert.fail(`Missing fact ${name}`);
  const object = await session.objects.get(oid);
  if (object?.kind !== "blob" || typeof object.value !== "string") {
    assert.fail(`Fact ${name} is not a string blob`);
  }
  return object.value;
}

test("seeds named SQLite sessions with deterministic rich transcripts", async () => {
  const assistantMarkdown = `## Focused fixture

| path | source |
| --- | --- |
| transcript | SQLite |

\`\`\`json
{"deterministic":true}
\`\`\`
`;
  const fixture = await createDesktopBenchmarkFixture({
    sessionCount: 2,
    turnsPerSession: 3,
    assistantMarkdown,
    catalogModelCount: 5,
  });
  fixtures.push(fixture);

  assert.equal(process.env.HOME, fixture.paths.home);
  assert.equal(process.env.NYTE_HOME, fixture.paths.nyteHome);
  assert.deepEqual(fixture.sessionIds, [
    "desktop-benchmark-session-0001",
    "desktop-benchmark-session-0002",
  ]);
  assert.deepEqual(await createWorkspaceStore().list(), [
    {
      path: fixture.paths.workspace,
      name: "workspace",
      lastOpenedAt: DESKTOP_BENCHMARK_EPOCH_MS,
      available: true,
    },
  ]);
  const trust = await createWorkspaceStore().resolve(fixture.paths.workspace);
  assert.equal(trust.kind, "trusted");
  if (trust.kind !== "trusted") assert.fail("Fixture workspace was not trusted");
  assert.equal(trust.workspace.cwd, fixture.paths.workspace);
  assert.equal(trust.inheritedFrom, fixture.paths.workspace);
  assert.equal(await readLastWorkspace(), fixture.paths.workspace);

  const store = new SqliteStore(fixture.paths.workspaceStore);
  try {
    assert.deepEqual(
      (await store.list()).map((session) => session.id),
      fixture.sessionIds,
    );
    for (const seeded of fixture.sessions) {
      const session = await store.open(seeded.id);
      try {
        assert.equal(await readStringFact(session, "refs/facts/name"), seeded.name);
        assert.equal(await readStringFact(session, "refs/facts/cwd"), fixture.paths.workspace);
        assert.deepEqual(
          (await session.refs.list("refs/facts/")).map((ref) => ref.name),
          ["refs/facts/cwd", "refs/facts/name"],
        );
        assert.equal(await session.refs.read("refs/heads/main"), seeded.tip);

        const commits = await branch(session.objects, seeded.tip);
        assert.equal(commits.length, seeded.turnCount * 2);
        const transcript = transcriptFromCommits(commits);
        assert.equal(transcript.length, seeded.turnCount);
        for (const [turnIndex, turn] of transcript.entries()) {
          if (turn.kind !== "turn") assert.fail("Expected a conversation turn");
          assert.equal(turn.outcome, "completed");
          assert.equal(turn.parts.length, 2);
          const user = turn.parts[0];
          const assistant = turn.parts[1];
          if (user?.kind !== "user") assert.fail("Expected a user transcript part");
          if (assistant?.kind !== "assistant") {
            assert.fail("Expected an assistant transcript part");
          }
          assert.equal(
            user.content,
            `Benchmark prompt ${String(turnIndex + 1).padStart(4, "0")} for ${seeded.name}`,
          );
          assert.equal(assistant.text, assistantMarkdown);
        }
      } finally {
        await session.close();
      }
    }
  } finally {
    await store.close();
  }
});

test("persists a 1,200-model OpenCode catalog that the desktop restores offline", async () => {
  const fixture = await createDesktopBenchmarkFixture({
    sessionCount: 1,
    turnsPerSession: 1,
    catalogModelCount: DEFAULT_CATALOG_MODEL_COUNT,
  });
  fixtures.push(fixture);

  const stored = await new FileModelsStore(fixture.paths.modelCatalog).read("opencode");
  if (stored === undefined) assert.fail("Missing persisted OpenCode catalog");
  assert.equal(stored.models.length, DEFAULT_CATALOG_MODEL_COUNT);
  assert.equal(stored.checkedAt, DESKTOP_BENCHMARK_EPOCH_MS);
  assert.equal(stored.lastModified, DESKTOP_BENCHMARK_EPOCH_MS);
  assert.equal(stored.etag, '"nyte-desktop-benchmark-v1"');
  assert.equal(stored.models[0]?.id, fixture.catalog.firstModelId);
  assert.equal(stored.models.at(-1)?.id, fixture.catalog.lastModelId);
  assert.ok(stored.models.every((model) => model.provider === "opencode"));

  const models = createNyteModels();
  await loadPersistedCatalog(models);
  const restored = models
    .getModels("opencode")
    .filter((model) => model.id.startsWith(fixture.catalog.modelIdPrefix));
  assert.equal(restored.length, DEFAULT_CATALOG_MODEL_COUNT);
  assert.equal(
    models.getModel("opencode", fixture.catalog.firstModelId)?.name,
    "Desktop benchmark model 0001",
  );
  assert.equal(
    models.getModel("opencode", fixture.catalog.lastModelId)?.name,
    "Desktop benchmark model 1200",
  );
});
