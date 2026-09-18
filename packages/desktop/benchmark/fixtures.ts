import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { FileModelsStore } from "@nyte-ai/ai";
import type { Model } from "@nyte-ai/ai";
import { SqliteStore } from "@nyte-ai/core/store";
import type { Session } from "@nyte-ai/core/store";
import { createWorkspaceStore, workspaceStorePath } from "@nyte-ai/host";
import type { Commit, CommitBody } from "@nyte-ai/protocol";
import { rememberWorkspace } from "../src/main/workspaces.ts";

export const DESKTOP_BENCHMARK_SEED = "nyte-desktop-benchmark-v1";
export const DESKTOP_BENCHMARK_EPOCH_MS = 1_700_000_000_000;
export const DEFAULT_CATALOG_MODEL_COUNT = 1_200;

export const DEFAULT_ASSISTANT_MARKDOWN = `# Benchmark result

> A deterministic response for desktop rendering benchmarks.

- [x] Seed a real SQLite transcript
- [x] Render **bold**, _italic_, and [linked text](https://example.invalid/benchmark)
- [ ] Measure the next interaction

| Metric | Value |
| --- | ---: |
| Sessions | deterministic |
| Provider calls | 0 |

\`\`\`ts
const result = { stable: true, source: "sqlite" };
\`\`\`

1. Reopen the session.
2. Read the persisted transcript.
3. Compare the result.
`;

const MODEL_ID_PREFIX = "desktop-benchmark-model-";

export interface DesktopBenchmarkFixtureOptions {
  readonly sessionCount?: number;
  readonly turnsPerSession?: number;
  readonly assistantMarkdown?: string;
  readonly catalogModelCount?: number;
  /** A new isolated fixture directory is created below this directory. */
  readonly parentDirectory?: string;
}

export interface DesktopBenchmarkPaths {
  readonly root: string;
  readonly home: string;
  readonly nyteHome: string;
  readonly workspace: string;
  readonly workspaceStore: string;
  readonly modelCatalog: string;
  readonly workspaces: string;
  readonly rememberedWorkspace: string;
}

export interface DesktopBenchmarkSession {
  readonly id: string;
  readonly name: string;
  readonly tip: string;
  readonly turnCount: number;
}

export interface DesktopBenchmarkCatalog {
  readonly providerId: "opencode";
  readonly modelCount: number;
  readonly modelIdPrefix: string;
  readonly firstModelId: string;
  readonly lastModelId: string;
}

export interface DesktopBenchmarkMetadata {
  readonly seed: string;
  readonly epochMs: number;
  readonly sessionCount: number;
  readonly turnsPerSession: number;
  readonly totalTurns: number;
  readonly totalCommits: number;
  readonly assistantCharacters: number;
  readonly catalogModelCount: number;
}

export interface DesktopBenchmarkFixture {
  readonly env: {
    readonly HOME: string;
    readonly NYTE_HOME: string;
  };
  readonly paths: DesktopBenchmarkPaths;
  readonly sessions: readonly DesktopBenchmarkSession[];
  readonly sessionIds: readonly string[];
  readonly catalog: DesktopBenchmarkCatalog;
  readonly metadata: DesktopBenchmarkMetadata;
  cleanup(): Promise<void>;
}

interface EnvironmentSnapshot {
  readonly home: string | undefined;
  readonly nyteHome: string | undefined;
}

function restoreEnvironment(snapshot: EnvironmentSnapshot): void {
  if (snapshot.home === undefined) delete process.env.HOME;
  else process.env.HOME = snapshot.home;
  if (snapshot.nyteHome === undefined) delete process.env.NYTE_HOME;
  else process.env.NYTE_HOME = snapshot.nyteHome;
}

function integer(value: number | undefined, fallback: number, name: string, minimum = 1): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum) {
    throw new RangeError(`${name} must be a safe integer of at least ${String(minimum)}`);
  }
  return resolved;
}

function numbered(value: number): string {
  return String(value + 1).padStart(4, "0");
}

function catalogModel(index: number): Model<"openai-responses"> {
  const suffix = numbered(index);
  return {
    id: `${MODEL_ID_PREFIX}${suffix}`,
    name: `Desktop benchmark model ${suffix}`,
    api: "openai-responses",
    provider: "opencode",
    baseUrl: "https://benchmark.invalid/v1",
    reasoning: index % 3 === 0,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 128_000 + index,
    maxTokens: 16_384,
  };
}

async function appendCommit(
  session: Session,
  parent: string | null,
  body: CommitBody,
  at: number,
): Promise<string> {
  const commit = { kind: "commit", parent, body, at } satisfies Commit;
  const [oid] = await session.objects.put([commit]);
  if (oid === undefined) throw new Error("SQLite did not return an object id for a commit");
  return oid;
}

async function seedSession(
  store: SqliteStore,
  workspace: string,
  sessionIndex: number,
  turnsPerSession: number,
  assistantMarkdown: string,
): Promise<DesktopBenchmarkSession> {
  const suffix = numbered(sessionIndex);
  const id = `desktop-benchmark-session-${suffix}`;
  const name = `Desktop benchmark session ${suffix}`;
  const session = await store.create({ id });
  try {
    const [nameOid, cwdOid] = await session.objects.put([
      { kind: "blob", value: name },
      { kind: "blob", value: workspace },
    ]);
    if (nameOid === undefined || cwdOid === undefined) {
      throw new Error("SQLite did not return object ids for the session facts");
    }
    let tip: string | null = null;
    for (let turnIndex = 0; turnIndex < turnsPerSession; turnIndex += 1) {
      const at = DESKTOP_BENCHMARK_EPOCH_MS + sessionIndex * turnsPerSession * 2 + turnIndex * 2;
      const userBody = {
        kind: "message",
        message: {
          role: "user",
          content: `Benchmark prompt ${numbered(turnIndex)} for ${name}`,
          timestamp: at,
        },
      } satisfies CommitBody;
      tip = await appendCommit(session, tip, userBody, at);
      const assistantBody = {
        kind: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: assistantMarkdown }],
          stopReason: "stop",
          provider: "opencode",
          api: "openai-responses",
          model: `${MODEL_ID_PREFIX}0001`,
          timestamp: at + 1,
          usage: {
            input: 256 + turnIndex,
            output: 128 + turnIndex,
            cacheRead: 32,
            cacheWrite: 0,
            totalTokens: 416 + turnIndex * 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      } satisfies CommitBody;
      tip = await appendCommit(session, tip, assistantBody, at + 1);
    }
    if (tip === null) throw new Error("A benchmark session must contain at least one turn");
    const outcome = await session.refs.update(
      [
        { name: "refs/facts/name", from: null, to: nameOid },
        { name: "refs/facts/cwd", from: null, to: cwdOid },
        { name: "refs/heads/main", from: null, to: tip },
      ],
      { reason: "benchmark-seed" },
    );
    if (!outcome.ok) throw new Error(`Could not publish benchmark session ${id}`);
    return { id, name, tip, turnCount: turnsPerSession };
  } finally {
    await session.close();
  }
}

/**
 * Seeds the same files the desktop opens, then leaves HOME and NYTE_HOME set so
 * a Playwright Electron launch inherits the isolated fixture. Cleanup restores
 * the previous environment and removes the fixture directory.
 */
export async function createDesktopBenchmarkFixture(
  options: DesktopBenchmarkFixtureOptions = {},
): Promise<DesktopBenchmarkFixture> {
  const sessionCount = integer(options.sessionCount, 24, "sessionCount", 0);
  const turnsPerSession = integer(options.turnsPerSession, 12, "turnsPerSession");
  const catalogModelCount = integer(options.catalogModelCount, 1, "catalogModelCount");
  const assistantMarkdown = options.assistantMarkdown ?? DEFAULT_ASSISTANT_MARKDOWN;
  if (typeof assistantMarkdown !== "string" || assistantMarkdown.trim() === "") {
    throw new RangeError("assistantMarkdown must be a non-empty string");
  }
  const totalTurns = sessionCount * turnsPerSession;
  const totalCommits = totalTurns * 2;
  if (
    !Number.isSafeInteger(totalTurns) ||
    !Number.isSafeInteger(totalCommits) ||
    !Number.isSafeInteger(DESKTOP_BENCHMARK_EPOCH_MS + totalCommits)
  ) {
    throw new RangeError("The requested benchmark fixture is too large");
  }

  const parentDirectory = resolve(options.parentDirectory ?? tmpdir());
  await mkdir(parentDirectory, { recursive: true });
  const root = await realpath(await mkdtemp(join(parentDirectory, "nyte-desktop-benchmark-")));
  const home = join(root, "home");
  const nyteHome = join(root, "nyte-home");
  const workspaceDirectory = join(root, "workspace");
  await Promise.all(
    [home, nyteHome, workspaceDirectory].map((path) => mkdir(path, { recursive: true })),
  );

  const previousEnvironment: EnvironmentSnapshot = {
    home: process.env.HOME,
    nyteHome: process.env.NYTE_HOME,
  };
  process.env.HOME = home;
  process.env.NYTE_HOME = nyteHome;

  let store: SqliteStore | undefined;
  try {
    const workspaces = createWorkspaceStore();
    const trustedWorkspace = await workspaces.trust(workspaceDirectory);
    const workspace = trustedWorkspace.cwd;
    await workspaces.touch(workspace, DESKTOP_BENCHMARK_EPOCH_MS);
    await rememberWorkspace(workspace);

    const modelCatalog = join(nyteHome, "models-store.json");
    const models = Array.from({ length: catalogModelCount }, (_, index) => catalogModel(index));
    await new FileModelsStore(modelCatalog).write("opencode", {
      models,
      lastModified: DESKTOP_BENCHMARK_EPOCH_MS,
      checkedAt: DESKTOP_BENCHMARK_EPOCH_MS,
      etag: `"${DESKTOP_BENCHMARK_SEED}"`,
    });

    const workspaceStore = await workspaceStorePath(workspace);
    store = new SqliteStore(workspaceStore);
    const sessions: DesktopBenchmarkSession[] = [];
    for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
      sessions.push(
        await seedSession(store, workspace, sessionIndex, turnsPerSession, assistantMarkdown),
      );
    }
    await store.close();
    store = undefined;

    let cleaned = false;
    const fixture: DesktopBenchmarkFixture = {
      env: { HOME: home, NYTE_HOME: nyteHome },
      paths: {
        root,
        home,
        nyteHome,
        workspace,
        workspaceStore,
        modelCatalog,
        workspaces: workspaces.path,
        rememberedWorkspace: join(nyteHome, "desktop-workspace.json"),
      },
      sessions,
      sessionIds: sessions.map((session) => session.id),
      catalog: {
        providerId: "opencode",
        modelCount: catalogModelCount,
        modelIdPrefix: MODEL_ID_PREFIX,
        firstModelId: `${MODEL_ID_PREFIX}0001`,
        lastModelId: `${MODEL_ID_PREFIX}${numbered(catalogModelCount - 1)}`,
      },
      metadata: {
        seed: DESKTOP_BENCHMARK_SEED,
        epochMs: DESKTOP_BENCHMARK_EPOCH_MS,
        sessionCount,
        turnsPerSession,
        totalTurns,
        totalCommits,
        assistantCharacters: assistantMarkdown.length,
        catalogModelCount,
      },
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        try {
          await rm(root, { recursive: true, force: true });
        } finally {
          restoreEnvironment(previousEnvironment);
        }
      },
    };
    return fixture;
  } catch (error) {
    if (store !== undefined) await store.close().catch(() => undefined);
    restoreEnvironment(previousEnvironment);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
