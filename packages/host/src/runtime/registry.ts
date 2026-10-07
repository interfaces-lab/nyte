/**
 * The folders one host profile serves. This file is the one authority for
 * both membership and trust: a row records the canonical directory and the
 * identity (device and inode) it had when registered; a grant records the
 * identity the owner approved. Every resolution re-derives the directory's
 * identity and refuses to serve a path that now names something else, so a
 * folder swapped for a symlink or recreated under the same name is `changed`
 * until the owner looks again.
 *
 * The trust rule is the local terminal's `ask` rule, applied here to the
 * profile's own rows: a folder with no project input runs without a grant;
 * one with project input waits for the owner's grant. Registering grants
 * nothing, loads nothing and creates no session.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, sep } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { RegisterOutcome, RegisteredWorkspace, TrustOutcome } from "@nyte-ai/protocol";
import { hasProjectInput, isFileError } from "../paths.ts";
import { decidedWorkspace, workspaceName } from "../workspace-store.ts";
import type { TrustedWorkspace, WorkspaceTrustResolution } from "../workspace-store.ts";

const Folder = Type.Object(
  { dev: Type.String({ minLength: 1 }), ino: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

type Folder = Static<typeof Folder>;

const Grant = Type.Object(
  { grantedAt: Type.Number({ minimum: 0 }), folder: Folder },
  { additionalProperties: false },
);

const Row = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
    registeredAt: Type.Number({ minimum: 0 }),
    /** The directory as registered; serving requires the path to still name it. */
    folder: Folder,
    grant: Type.Union([Grant, Type.Null()]),
  },
  { additionalProperties: false },
);

const RegistryFile = Type.Object(
  { version: Type.Literal(1), workspaces: Type.Array(Row) },
  { additionalProperties: false },
);

type Row = Static<typeof Row>;

/** What an id names right now, for the SDK and for policy. */
export type WorkspaceResolution =
  | { readonly kind: "unknown" }
  | { readonly kind: "unavailable"; readonly path: string }
  /** The path names a different directory than the one registered, or one outside the host's roots. */
  | { readonly kind: "changed"; readonly path: string }
  /** The folder carries project input and has no grant for its current identity. */
  | { readonly kind: "untrusted"; readonly path: string }
  | { readonly kind: "ready"; readonly path: string; readonly workspace: TrustedWorkspace };

async function folderAt(path: string): Promise<Folder | undefined> {
  const info = await stat(path, { bigint: true }).catch(() => undefined);

  return info?.isDirectory() === true
    ? { dev: String(info.dev), ino: String(info.ino) }
    : undefined;
}

function sameFolder(left: Folder, right: Folder): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** The opaque token a `list` row carries and a grant echoes. */
function identityOf(path: string, folder: Folder): string {
  return createHash("sha256")
    .update(`${path}\0${folder.dev}\0${folder.ino}`)
    .digest("base64url")
    .slice(0, 22);
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

export interface WorkspaceRegistryOptions {
  readonly path: string;
  /** Canonical directories registration and serving are confined to; none means any directory the host can read. */
  readonly roots?: readonly string[];
}

/** A row and the directory its path names now, checked together. */
interface Inspected {
  readonly row: Row;
  readonly current: Folder | undefined;
  /** The path still names the registered directory and lies within the roots. */
  readonly intact: boolean;
}

export class WorkspaceRegistry {
  private readonly path: string;
  private readonly roots: readonly string[] | undefined;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: WorkspaceRegistryOptions) {
    this.path = options.path;
    this.roots = options.roots;
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private async read(): Promise<Row[]> {
    const text = await readFile(this.path, "utf8").catch((cause: unknown) => {
      if (isFileError(cause, ["ENOENT"])) return undefined;
      throw cause;
    });

    if (text === undefined) return [];
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Corrupt registry: ${this.path}`);
    }

    if (!Value.Check(RegistryFile, parsed)) throw new Error(`Corrupt registry: ${this.path}`);

    return parsed.workspaces;
  }

  private async write(rows: readonly Row[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, workspaces: rows }, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }

  private allowed(path: string): boolean {
    return this.roots === undefined || this.roots.some((root) => within(path, root));
  }

  /** Re-derive what the path names: canonical again, the same inode, inside the roots. */
  private async inspect(row: Row): Promise<Inspected> {
    const canonical = await realpath(row.path).catch(() => undefined);
    const current = canonical === undefined ? undefined : await folderAt(canonical);

    const intact =
      canonical === row.path &&
      current !== undefined &&
      sameFolder(current, row.folder) &&
      this.allowed(row.path);

    return { row, current, intact };
  }

  private resolveInspected({ row, current, intact }: Inspected): WorkspaceResolution {
    if (current === undefined) return { kind: "unavailable", path: row.path };

    if (!intact) return { kind: "changed", path: row.path };
    const granted = row.grant !== null && sameFolder(row.grant.folder, current);

    if (granted)
      return { kind: "ready", path: row.path, workspace: decidedWorkspace(row.path, true) };

    if (!hasProjectInput(row.path)) {
      return { kind: "ready", path: row.path, workspace: decidedWorkspace(row.path, false) };
    }

    return { kind: "untrusted", path: row.path };
  }

  private describeInspected(inspected: Inspected): RegisteredWorkspace {
    const { row, current } = inspected;
    const resolution = this.resolveInspected(inspected);

    const base = {
      id: row.id,
      path: row.path,
      name: workspaceName(row.path),
      registeredAt: row.registeredAt,
      identity: identityOf(row.path, current ?? row.folder),
    };

    switch (resolution.kind) {
      case "ready":
        return row.grant !== null && current !== undefined && sameFolder(row.grant.folder, current)
          ? { ...base, trust: { kind: "granted", grantedAt: row.grant.grantedAt } }
          : { ...base, trust: { kind: "policy" } };
      case "untrusted":
        return { ...base, trust: { kind: "none" } };
      case "changed":
        return { ...base, trust: { kind: "changed" } };
      case "unavailable":
      case "unknown":
        return { ...base, trust: { kind: "unavailable" } };
      default: {
        const _exhaustive: never = resolution;

        return _exhaustive;
      }
    }
  }

  list(): Promise<readonly RegisteredWorkspace[]> {
    return this.serialized(async () =>
      Promise.all(
        (await this.read()).map(async (row) => this.describeInspected(await this.inspect(row))),
      ),
    );
  }

  /** Canonicalize and mint. Grants nothing, loads nothing, creates no session. */
  register(path: string): Promise<RegisterOutcome> {
    return this.serialized(async () => {
      if (!isAbsolute(path)) return { kind: "not_absolute", path };
      const canonical = await realpath(path).catch(() => undefined);
      const folder = canonical === undefined ? undefined : await folderAt(canonical);

      if (canonical === undefined || folder === undefined) return { kind: "not_directory", path };

      if (!this.allowed(canonical)) return { kind: "outside_roots", path: canonical };
      const rows = await this.read();
      const existing = rows.find((row) => row.path === canonical);

      if (existing !== undefined) {
        return { kind: "exists", workspace: this.describeInspected(await this.inspect(existing)) };
      }

      const row: Row = {
        id: randomUUID(),
        path: canonical,
        registeredAt: Date.now(),
        folder,
        grant: null,
      };
      await this.write([...rows, row]);

      return { kind: "registered", workspace: this.describeInspected(await this.inspect(row)) };
    });
  }

  /**
   * The owner saw `path` with `identity` for `id` and grants it. The grant
   * binds to the directory that identity names. When the path now names a
   * different directory than the one registered, approving the identity the
   * list shows for it is the owner's fresh consent to that directory: the
   * row is rebound to it. An identity that matches neither grants nothing
   * and the fresh row comes back to look at again.
   */
  grant(id: string, path: string, identity: string): Promise<TrustOutcome> {
    return this.serialized(async () => {
      const rows = await this.read();
      const index = rows.findIndex((row) => row.id === id);
      const row = rows[index];

      if (row === undefined) return { kind: "unknown" };
      const inspected = await this.inspect(row);
      const { current } = inspected;

      if (current === undefined) return { kind: "unavailable" };

      if (path !== row.path) return { kind: "path_mismatch", path: row.path };
      const canonical = await realpath(row.path).catch(() => undefined);

      if (
        canonical !== row.path ||
        !this.allowed(row.path) ||
        identityOf(row.path, current) !== identity
      ) {
        return { kind: "identity_changed", workspace: this.describeInspected(inspected) };
      }

      const granted: Row = {
        ...row,
        folder: current,
        grant: { grantedAt: Date.now(), folder: current },
      };
      await this.write(rows.with(index, granted));

      return { kind: "granted", workspace: this.describeInspected(await this.inspect(granted)) };
    });
  }

  /** Remove the row and its grant. The caller checks for live work first. */
  forget(id: string): Promise<{ readonly kind: "forgotten" | "unknown" }> {
    return this.serialized(async () => {
      const rows = await this.read();

      if (!rows.some((candidate) => candidate.id === id)) return { kind: "unknown" };
      await this.write(rows.filter((candidate) => candidate.id !== id));

      return { kind: "forgotten" };
    });
  }

  resolve(id: string): Promise<WorkspaceResolution> {
    return this.serialized(async () => {
      const row = (await this.read()).find((candidate) => candidate.id === id);

      return row === undefined
        ? { kind: "unknown" }
        : this.resolveInspected(await this.inspect(row));
    });
  }

  /** The row whose canonical path is `cwd`, for a session that already acts there. */
  resolveCwd(cwd: string): Promise<WorkspaceTrustResolution | undefined> {
    return this.serialized(async () => {
      const row = (await this.read()).find((candidate) => candidate.path === cwd);

      if (row === undefined) return undefined;
      const resolution = this.resolveInspected(await this.inspect(row));

      switch (resolution.kind) {
        case "ready":
          return { kind: "trusted", workspace: resolution.workspace };
        case "untrusted":
          return { kind: "unknown", cwd: resolution.path };
        case "changed":
        case "unavailable":
        case "unknown":
          return undefined;
        default: {
          const _exhaustive: never = resolution;

          return _exhaustive;
        }
      }
    });
  }
}
