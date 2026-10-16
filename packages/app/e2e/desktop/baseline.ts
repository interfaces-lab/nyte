import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { dev } from "@nyte-ai/core";
import { idSchema } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/schema";
import { sdk } from "@nyte-ai/sdk";
import { E2E_MODEL, e2eModels } from "../../../desktop/src/main/fixtures/e2e-models.ts";

const APP_ROOT = resolve(import.meta.dirname, "../..");

const REPO_ROOT = resolve(APP_ROOT, "../..");

const CACHE_ROOT = resolve(APP_ROOT, "e2e/.cache/desktop");

export const LONG_TURNS = 36;

export const FIXTURES = {
  alpha: "Alpha release",
  beta: "Beta rollout",
  sidebar: "Sidebar chores",
  composer: "Composer drafts",
  thinking: "Thinking aloud",
  markdown: "Markdown showcase",
  long: "Long transcript",
} as const;

export type Fixture = keyof typeof FIXTURES;

const TRANSCRIPTS: Record<Fixture, readonly string[]> = {
  alpha: ["Hello from alpha"],
  beta: ["Hello from beta", "Second beta turn"],
  sidebar: ["Hello from the sidebar chat"],
  composer: ["A first draft"],
  thinking: ["/think"],
  markdown: ["/markdown"],
  long: Array.from({ length: LONG_TURNS }, (_, index) => `/long 3 turn ${String(index + 1)}`),
};

const ManifestSchema = Type.Object({
  sessions: Type.Record(Type.String(), idSchema<"session">()),
});

type Manifest = Type.Static<typeof ManifestSchema>;

const FIXTURE_NAMES = Object.keys(FIXTURES).filter((name): name is Fixture => name in FIXTURES);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });

  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.includes(".test."),
    )
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

async function fingerprint(): Promise<string> {
  const files = [
    join(APP_ROOT, "e2e/desktop/baseline.ts"),
    join(REPO_ROOT, "packages/desktop/src/main/fixtures/e2e-models.ts"),
    join(REPO_ROOT, "packages/host/src/sqlite.ts"),
    join(REPO_ROOT, "packages/host/src/store-rows.ts"),
    join(REPO_ROOT, "pnpm-lock.yaml"),
    ...(await sourceFiles(join(REPO_ROOT, "packages/core/src"))),
    ...(await sourceFiles(join(REPO_ROOT, "packages/schema/src"))),
  ];

  const hash = createHash("sha256");

  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(file));
  }

  return hash.digest("hex").slice(0, 16);
}

function openOffline(home: string) {
  dev.off();

  return sdk.open({
    models: e2eModels().models,
    home,
    workspace: { kind: "local", path: home },
  });
}

async function seed(home: string): Promise<Manifest> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const host = await openOffline(home);

  try {
    await host.models.setDefault(E2E_MODEL);
    const sessions: Record<string, SessionId> = {};

    for (const fixture of FIXTURE_NAMES) {
      const session = await host.sessions.create({ name: FIXTURES[fixture] });
      sessions[fixture] = session.id;

      for (const text of TRANSCRIPTS[fixture]) {
        const receipt = await session.send(text);
        const outcome = await receipt.settled();

        if (outcome.kind !== "completed")
          throw new Error(`Seeding ${FIXTURES[fixture]} failed on ${text}: ${outcome.kind}`);
      }
    }

    return { sessions };
  } finally {
    await host.close();
  }
}

export async function ensureBaseline(): Promise<string> {
  const published = join(CACHE_ROOT, await fingerprint());
  const manifest = join(published, "manifest.json");

  if (
    await readFile(manifest).then(
      () => true,
      () => false,
    )
  )
    return published;
  await mkdir(CACHE_ROOT, { recursive: true });
  const building = join(CACHE_ROOT, `building-${randomUUID()}`);

  try {
    const seeded = await seed(join(building, "home"));
    await writeFile(join(building, "manifest.json"), JSON.stringify(seeded, null, 2));
    await rename(building, published).catch(async (cause: NodeJS.ErrnoException) => {
      if (cause.code !== "EEXIST" && cause.code !== "ENOTEMPTY") throw cause;
      await rm(building, { recursive: true, force: true });
    });
  } catch (cause) {
    await rm(building, { recursive: true, force: true });
    throw cause;
  }

  return published;
}

export interface PreparedHome {
  readonly home: string;
  readonly sessions: Readonly<Record<Fixture, SessionId>>;
}

export async function prepareHome(parent: string): Promise<PreparedHome> {
  const baseline = await ensureBaseline();
  const home = join(parent, "home");
  await cp(join(baseline, "home"), home, { recursive: true });

  const manifest = Value.Parse(
    ManifestSchema,
    JSON.parse(await readFile(join(baseline, "manifest.json"), "utf8")),
  );

  const host = await openOffline(home);

  try {
    const workspaces = await host.workspaces.list();

    const current = workspaces.find(
      (workspace) => "path" in workspace.target && workspace.target.path === home,
    );

    if (current === undefined) throw new Error(`The home workspace is not listed for ${home}`);

    for (const id of Object.values(manifest.sessions))
      await host.session(id).update({ workspace: current.id });

    for (const workspace of workspaces)
      if (workspace.id !== current.id) await host.workspaces.forget(workspace.id);
  } finally {
    await host.close();
  }

  const sessions = (fixture: Fixture): SessionId => {
    const id = manifest.sessions[fixture];

    if (id === undefined) throw new Error(`The baseline manifest lacks ${fixture}`);

    return id;
  };

  return {
    home,
    sessions: {
      alpha: sessions("alpha"),
      beta: sessions("beta"),
      sidebar: sessions("sidebar"),
      composer: sessions("composer"),
      thinking: sessions("thinking"),
      markdown: sessions("markdown"),
      long: sessions("long"),
    },
  };
}
