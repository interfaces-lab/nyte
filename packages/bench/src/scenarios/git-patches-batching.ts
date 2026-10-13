import type { Scenario } from "../scenario.ts";
import { invariant, timed } from "../scenario.ts";

/** §3b git.patches: expanding every file costs a few host reads, not one per file; a revision bump serves stale entries until fresh ones land. */
export const gitPatchesBatching: Scenario = {
  name: "git-patches-batching",
  guarantee:
    "patches(scope, 500 paths) makes ≤ ceil(500 / batch) git reads and serves stale-until-fresh across a revision bump.",
  async run(driver) {
    const bench = await driver.open({ changedFiles: 500 });
    const [info] = await bench.host.workspaces.list();
    if (info === undefined) throw new Error("fixture made no workspace");
    const workspace = bench.host.workspace(info.id);
    const git = await workspace.git();
    if (git.kind !== "available") throw new Error("fixture has no git");
    const changes = await git.api.changes({ kind: "worktree" });
    const paths = changes.files.map((file) => file.path);
    const readsBefore = bench.counters.gitDiffReads?.() ?? 0;
    const full = await timed(async () => {
      for await (const set of git.api.patches({ kind: "worktree" }, paths)) {
        if (
          set.entries.size === paths.length &&
          [...set.entries.values()].every((entry) => entry.fresh)
        )
          return set;
      }
      throw new Error("patches never completed");
    });
    const reads = (bench.counters.gitDiffReads?.() ?? 0) - readsBefore;
    const files = await workspace.files();
    if (files.kind !== "available") throw new Error("fixture has no files");
    await files.api.write(paths[0] ?? "", "bumped\n");
    let sawStale = false;
    let sawFresh = false;

    for await (const set of git.api.patches({ kind: "worktree" }, paths.slice(0, 1))) {
      const entry = set.entries.get(paths[0] ?? "");
      if (entry !== undefined && !entry.fresh) sawStale = true;
      if (entry !== undefined && entry.fresh && set.revision !== full.value.revision) {
        sawFresh = true;
        break;
      }
    }

    await bench.close();

    return {
      name: this.name,
      invariants: [
        invariant(
          "every requested path got a fresh entry",
          full.value.entries.size === paths.length,
        ),
        invariant(
          "after a write, the old entry stood in until the fresh one landed",
          sawStale && sawFresh,
        ),
      ],
      metrics: { hostReadsMax: reads, fullExpandMs: full.ms },
    };
  },
};
