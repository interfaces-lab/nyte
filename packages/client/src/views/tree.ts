/**
 * The session tree as a client draws it: parent-linked commits folded into
 * nodes, the selected tip's path marked, and navigation behavior shared by
 * every client.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts
 * (getTree) and https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts
 * (collectEntriesForBranchSummary).
 */
import type { Commit, Oid } from "@nyte-ai/protocol";

export interface SessionTreeNode {
  readonly oid: Oid;
  readonly commit: Commit;
  /** Oldest first by commit time, then oid. */
  readonly children: readonly SessionTreeNode[];
  /** True on the path from a root to the selected tip. */
  readonly active: boolean;
  /** Root is 0. */
  readonly depth: number;
  /** Head names whose tip is this commit. */
  readonly heads: readonly string[];
}

export interface SessionTree {
  /** Oldest first. More than one root means the graph contains orphans. */
  readonly roots: readonly SessionTreeNode[];
  readonly tip: Oid | null;
  /** Commit oids from the tip up to its root, in no particular order. */
  readonly activePath: ReadonlySet<Oid>;
}

type StoredCommit = { readonly oid: Oid; readonly commit: Commit };

interface AbandonedCommits {
  readonly commits: StoredCommit[];
  readonly commonAncestor: Oid | null;
}

/** Oids from `tip` up to a root, following parents found in `byOid`. */
function activePathOids(byOid: ReadonlyMap<Oid, Commit>, tip: Oid | null): Set<Oid> {
  const path = new Set<Oid>();
  let current = tip;
  while (current !== null && !path.has(current)) {
    path.add(current);
    current = byOid.get(current)?.parent ?? null;
  }
  return path;
}

function compareCommits(left: StoredCommit, right: StoredCommit): number {
  return left.commit.at - right.commit.at || left.oid.localeCompare(right.oid);
}

/** Fold every supplied commit into a forest. Commits may arrive in any order. */
export function projectTree(
  commits: readonly StoredCommit[],
  options: {
    readonly tip: Oid | null;
    readonly heads?: readonly { readonly head: string; readonly tip: Oid | null }[];
  },
): SessionTree {
  const byOid = new Map<Oid, Commit>();
  for (const item of commits) byOid.set(item.oid, item.commit);
  const activePath = activePathOids(byOid, options.tip);

  const headsAt = new Map<Oid, string[]>();
  for (const head of options.heads ?? []) {
    if (head.tip === null) continue;
    const names = headsAt.get(head.tip);
    if (names === undefined) headsAt.set(head.tip, [head.head]);
    else names.push(head.head);
  }

  const childrenByParent = new Map<Oid | null, StoredCommit[]>();
  const sorted = [...byOid].map(([oid, commit]) => ({ oid, commit })).toSorted(compareCommits);
  for (const item of sorted) {
    const parent =
      item.commit.parent !== null &&
      item.commit.parent !== item.oid &&
      byOid.has(item.commit.parent)
        ? item.commit.parent
        : null;
    const siblings = childrenByParent.get(parent);
    if (siblings === undefined) childrenByParent.set(parent, [item]);
    else siblings.push(item);
  }

  const build = (item: StoredCommit, depth: number): SessionTreeNode => ({
    oid: item.oid,
    commit: item.commit,
    depth,
    active: activePath.has(item.oid),
    heads: headsAt.get(item.oid) ?? [],
    children: (childrenByParent.get(item.oid) ?? []).map((child) => build(child, depth + 1)),
  });

  return {
    roots: (childrenByParent.get(null) ?? []).map((root) => build(root, 0)),
    tip: options.tip,
    activePath,
  };
}

export type NavigationTarget =
  | { readonly kind: "move"; readonly to: Oid | null }
  | {
      readonly kind: "restore";
      readonly to: Oid | null;
      readonly commit: StoredCommit;
    };

/** Where a selection lands. `undefined` means the start of the conversation. */
export function navigationTarget(selected: StoredCommit | undefined): NavigationTarget {
  if (selected === undefined) return { kind: "move", to: null };

  const body = selected.commit.body;
  switch (body.kind) {
    case "message":
      switch (body.message.role) {
        case "user":
          return { kind: "restore", to: selected.commit.parent, commit: selected };
        case "assistant":
        case "toolResult":
          return { kind: "move", to: selected.oid };
        default: {
          const _exhaustive: never = body.message;
          return _exhaustive;
        }
      }
    case "completion":
    case "checkpoint":
    case "summary":
    case "config":
    case "note":
      return { kind: "move", to: selected.oid };
    default: {
      const _exhaustive: never = body;
      return _exhaustive;
    }
  }
}

/**
 * Collect the commits below the deepest ancestor shared by `from` and
 * `selected`. The result is oldest first and selection-relative so a restored
 * user message does not count as abandoned work.
 */
export function collectAbandoned(
  byOid: ReadonlyMap<Oid, Commit>,
  options: { readonly from: Oid | null; readonly selected: Oid | null },
): AbandonedCommits {
  if (options.from === null) return { commits: [], commonAncestor: null };

  const selectedPath = activePathOids(byOid, options.selected);
  const commits: StoredCommit[] = [];
  const seen = new Set<Oid>();
  let current: Oid | null = options.from;
  while (current !== null && !selectedPath.has(current) && !seen.has(current)) {
    seen.add(current);
    const commit = byOid.get(current);
    if (commit === undefined) break;
    commits.push({ oid: current, commit });
    current = commit.parent;
  }
  commits.reverse();

  return {
    commits,
    commonAncestor: current !== null && selectedPath.has(current) ? current : null,
  };
}
