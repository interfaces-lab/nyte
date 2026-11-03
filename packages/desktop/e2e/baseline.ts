import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { dev } from "@nyte-ai/core";
import { idSchema } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/schema";
import { fakeModels } from "@nyte-ai/bench";
import { sdk } from "@nyte-ai/sdk";
import type { Host, SendReceipt } from "@nyte-ai/sdk";
import { e2eAnswers } from "../src/host/fixtures/e2e-models.ts";
import { E2E_MODEL } from "./host.ts";
import { polishModel } from "./polish-fixture.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const CACHE_ROOT = resolve(import.meta.dirname, ".cache");

export const LONG_TURNS = 36;

export const READ_TURNS = 5;

export const UNREAD_TURNS = 8;

export const FIXTURES = {
  alpha: "Alpha release",
  beta: "Beta rollout",
  sidebar: "Sidebar chores",
  composer: "Composer drafts",
  thinking: "Thinking aloud",
  markdown: "Markdown showcase",
  long: "Long transcript",
  unread: "Replies to catch up",
} as const;

type Fixture = keyof typeof FIXTURES;

const TRANSCRIPTS: Record<Fixture, readonly string[]> = {
  alpha: ["Hello from alpha"],
  beta: ["Hello from beta", "Second beta turn"],
  sidebar: ["Hello from the sidebar chat"],
  composer: ["A first draft"],
  thinking: ["/think"],
  markdown: ["/markdown"],
  long: Array.from({ length: LONG_TURNS }, (_, index) => `/long 3 turn ${String(index + 1)}`),
  unread: Array.from({ length: UNREAD_TURNS }, (_, index) => `/long 6 reply ${String(index + 1)}`),
};

const READ: Partial<Record<Fixture, number>> = { unread: READ_TURNS };

const READER_TOKEN = "e2e-baseline-reader";

const ManifestSchema = Type.Object({
  sessions: Type.Record(Type.String(), idSchema<"session">()),
  extra: Type.Optional(Type.Record(Type.String(), idSchema<"session">())),
});

export type ExtraChats = Readonly<Record<string, readonly string[]>>;

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

async function fingerprint(extra: ExtraChats): Promise<string> {
  const files = [
    join(import.meta.dirname, "baseline.ts"),
    join(REPO_ROOT, "packages/desktop/src/host/fixtures/e2e-models.ts"),
    join(import.meta.dirname, "host.ts"),
    join(REPO_ROOT, "packages/host/src/sqlite.ts"),
    join(REPO_ROOT, "packages/host/src/store-rows.ts"),
    join(REPO_ROOT, "pnpm-lock.yaml"),
    ...(await sourceFiles(join(REPO_ROOT, "packages/core/src"))),
    ...(await sourceFiles(join(REPO_ROOT, "packages/schema/src"))),
  ];

  const hash = createHash("sha256");
  hash.update(JSON.stringify(extra));

  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(file));
  }

  return hash.digest("hex").slice(0, 16);
}

/** Opens `home` in process over the scripted catalog, as the Anthropic model `nyte host` later reaches over HTTP, so the seeded chats name the model the e2e host serves. */
function openOffline(home: string) {
  dev.off();

  const models = fakeModels({
    id: E2E_MODEL.provider,
    models: [polishModel("http://127.0.0.1")],
    fallback: e2eAnswers({ home, log: () => undefined }),
  }).models;

  return sdk.open({ models, home, workspace: { kind: "local", path: home } });
}

/** Reads through the desktop's token, so the desktop opens the chat with this read mark. */
async function readAsDesktop(host: Host, session: SessionId): Promise<void> {
  await using listener = await host.listen({
    transport: { kind: "fetch" },
    auth: { kind: "token", token: READER_TOKEN },
  });

  const reader = await sdk.connect({
    url: "http://baseline.test",
    credentials: { kind: "token", token: READER_TOKEN },
    fetch: (url, init) => listener.fetch(new Request(url, init)),
  });

  try {
    const chat = reader.session(session);
    const tip = (await chat.info()).heads.find((head) => head.name === "main")?.tip;

    if (tip?.kind !== "commit") throw new Error(`Chat ${session} has no tip to read`);
    await chat.see(tip.id);
  } finally {
    await reader.close();
  }
}

async function seed(home: string, extra: ExtraChats): Promise<Manifest> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const host = await openOffline(home);

  try {
    await host.models.setDefault(E2E_MODEL);
    const sessions: Record<string, SessionId> = {};

    const settle = async (fixture: Fixture, text: string, receipt: SendReceipt): Promise<void> => {
      const outcome = await receipt.settled();

      if (outcome.kind !== "completed")
        throw new Error(`Seeding ${FIXTURES[fixture]} failed on ${text}: ${outcome.kind}`);
    };

    for (const fixture of FIXTURE_NAMES) {
      const [first, ...rest] = TRANSCRIPTS[fixture];

      if (first === undefined) throw new Error(`${FIXTURES[fixture]} has no first message`);

      const { session, receipt } = await host.sessions.start({
        name: FIXTURES[fixture],
        content: first,
      });

      sessions[fixture] = session.id;
      await settle(fixture, first, receipt);

      for (const [index, text] of rest.entries()) {
        if (index + 1 === READ[fixture]) await readAsDesktop(host, session.id);

        await settle(fixture, text, await session.send(text));
      }
    }

    const seeded: Record<string, SessionId> = {};

    for (const [name, prompts] of Object.entries(extra)) {
      const [first, ...rest] = prompts;

      if (first === undefined) throw new Error(`${name} has no first message`);
      const { session, receipt } = await host.sessions.start({ name, content: first });
      seeded[name] = session.id;
      await settleExtra(name, first, receipt);

      for (const text of rest) await settleExtra(name, text, await session.send(text));
    }

    return { sessions, extra: seeded };
  } finally {
    await host.close();
  }
}

async function settleExtra(name: string, text: string, receipt: SendReceipt): Promise<void> {
  const outcome = await receipt.settled();

  if (outcome.kind !== "completed")
    throw new Error(`Seeding ${name} failed on ${text}: ${outcome.kind}`);
}

async function ensureBaseline(extra: ExtraChats): Promise<string> {
  const published = join(CACHE_ROOT, await fingerprint(extra));
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
    const seeded = await seed(join(building, "home"), extra);
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

export async function prepareHome(parent: string, extra: ExtraChats = {}): Promise<PreparedHome> {
  const baseline = await ensureBaseline(extra);
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

    for (const id of [...Object.values(manifest.sessions), ...Object.values(manifest.extra ?? {})])
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
      unread: sessions("unread"),
    },
  };
}
