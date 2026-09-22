/**
 * The one durable workspace file every Nyte host shares:
 * `~/.nyte/workspaces.json` maps each realpath to whether it is trusted and
 * when it was last opened. Trust is the gate before a host loads project
 * input or gives the agent unrestricted workspace tools; it is not a sandbox.
 * Recency drives pickers and welcome screens.
 *
 * Reads tolerate bad rows: dropping a row never grants trust, so a corrupt
 * file fails safe by asking again, and one bad row must not brick a welcome
 * screen. Invalid rows are dropped and rewritten away on the next write.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { TRUSTED_WORKSPACE } from "@nyte-ai/core";
import type { TrustedWorkspace } from "@nyte-ai/core";
import type { WorkspaceInfo } from "@nyte-ai/protocol";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { withFileLeaseLock } from "./tree-snapshot.ts";

const WorkspaceRowSchema = Type.Object({
  trusted: Type.Boolean(),
  lastOpenedAt: Type.Number({ minimum: 0 }),
});

type WorkspaceRow = Static<typeof WorkspaceRowSchema>;

type StoreFile = Record<string, WorkspaceRow>;

export type WorkspaceTrustResolution =
  | {
      readonly kind: "trusted";
      readonly workspace: TrustedWorkspace;
      readonly inheritedFrom: string;
    }
  | { readonly kind: "unknown"; readonly cwd: string };

export class WorkspaceTrustRequired extends Error {
  readonly cwd: string;

  constructor(cwd: string) {
    super(`Workspace trust required: ${cwd}`);
    this.name = "WorkspaceTrustRequired";
    this.cwd = cwd;
  }
}

export function workspaceName(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment !== "");

  return segments.at(-1) ?? path;
}

const StoreFileSchema = Type.Record(Type.String(), Type.Unknown());

function parseStoreFile(text: string) {
  const rows: StoreFile = {};
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return rows;
  }

  if (!Value.Check(StoreFileSchema, value)) return rows;

  for (const [path, row] of Object.entries(value)) {
    if (!isAbsolute(path)) continue;

    if (!Value.Check(WorkspaceRowSchema, row)) continue;
    rows[path] = { trusted: row.trusted, lastOpenedAt: row.lastOpenedAt };
  }

  return rows;
}

function trusted(cwd: string): TrustedWorkspace {
  return Object.freeze({ cwd, [TRUSTED_WORKSPACE]: true as const });
}

async function workspaceDirectory(cwd: string): Promise<string> {
  const path = resolve(cwd);

  if (!existsSync(path)) throw new Error(`Workspace folder not found: ${path}`);
  const realPath = await realpath(path);

  if (!(await stat(realPath)).isDirectory()) {
    throw new Error(`Workspace path is not a folder: ${path}`);
  }

  return realPath;
}

function trustedAncestor(cwd: string, rows: StoreFile): string | undefined {
  let candidate = cwd;

  while (true) {
    if (rows[candidate]?.trusted === true) return candidate;
    const parent = dirname(candidate);

    if (parent === candidate) return undefined;
    candidate = parent;
  }
}

export interface WorkspaceStoreOptions {
  /** Untrusted entries kept beyond this are trimmed, oldest first, on `touch`. */
  readonly limit?: number;
}

/**
 * Owns realpath rows and serializes read-modify-write operations, so two
 * callers touching at once cannot lose each other's writes within one process.
 */
export class WorkspaceStore {
  readonly path: string;
  private readonly limit: number;
  private tail: Promise<void> = Promise.resolve();

  constructor(path: string, options: WorkspaceStoreOptions = {}) {
    if (!isAbsolute(path)) throw new Error("Workspace store path must be absolute");
    this.path = path;
    this.limit = options.limit ?? 50;
  }

  /** The trust decision for `cwd`, inherited from the nearest trusted ancestor. */
  resolve(cwd: string): Promise<WorkspaceTrustResolution> {
    return this.serialized(async () => {
      const realPath = await workspaceDirectory(cwd);
      const inheritedFrom = trustedAncestor(realPath, await this.read());

      return inheritedFrom === undefined
        ? { kind: "unknown", cwd: realPath }
        : { kind: "trusted", workspace: trusted(realPath), inheritedFrom };
    });
  }

  async require(cwd: string): Promise<TrustedWorkspace> {
    const resolution = await this.resolve(cwd);

    if (resolution.kind === "unknown") throw new WorkspaceTrustRequired(resolution.cwd);

    return resolution.workspace;
  }

  trust(cwd: string): Promise<TrustedWorkspace> {
    return this.serialized(() =>
      this.locked(async () => {
        const realPath = await workspaceDirectory(cwd);
        const rows = await this.read();
        rows[realPath] = { trusted: true, lastOpenedAt: rows[realPath]?.lastOpenedAt ?? 0 };
        await this.write(rows);

        return trusted(realPath);
      }),
    );
  }

  /** Known workspaces, newest first. */
  list(): Promise<WorkspaceInfo[]> {
    return this.serialized(async () => {
      const entries = Object.entries(await this.read());

      return Promise.all(
        entries
          .toSorted(([, a], [, b]) => b.lastOpenedAt - a.lastOpenedAt)
          .map(async ([path, row]) => ({
            path,
            name: workspaceName(path),
            lastOpenedAt: row.lastOpenedAt,
            available: await stat(path).then(
              (info) => info.isDirectory(),
              () => false,
            ),
          })),
      );
    });
  }

  touch(path: string, now = Date.now()): Promise<void> {
    return this.serialized(() =>
      this.locked(async () => {
        const realPath = await realpath(resolve(path)).catch(() => resolve(path));
        const rows = await this.read();
        rows[realPath] = { trusted: rows[realPath]?.trusted ?? false, lastOpenedAt: now };

        const kept = Object.entries(rows)
          .toSorted(([, a], [, b]) => b.lastOpenedAt - a.lastOpenedAt)
          .filter(([, row], index) => row.trusted || index < this.limit);

        await this.write(Object.fromEntries(kept));
      }),
    );
  }

  forget(path: string): Promise<void> {
    return this.serialized(() =>
      this.locked(async () => {
        const resolved = resolve(path);
        const realPath = await realpath(resolved).catch(() => undefined);
        const rows = await this.read();
        const before = Object.keys(rows).length;
        delete rows[resolved];

        if (realPath !== undefined) delete rows[realPath];

        if (Object.keys(rows).length !== before) await this.write(rows);
      }),
    );
  }

  private async locked<Result>(operation: () => Promise<Result>): Promise<Result> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });

    return withFileLeaseLock(`${this.path}.lock`, operation);
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private async read(): Promise<StoreFile> {
    if (!existsSync(this.path)) return {};

    return parseStoreFile(await readFile(this.path, "utf8"));
  }

  private async write(rows: StoreFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${String(process.pid)}.${randomUUID()}.tmp`;

    const ordered = Object.fromEntries(
      Object.keys(rows)
        .toSorted()
        .map((path) => [path, rows[path]]),
    );

    try {
      await writeFile(temporary, `${JSON.stringify(ordered, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
