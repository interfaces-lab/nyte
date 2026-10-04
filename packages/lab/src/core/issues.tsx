/**
 * What the kernel does wrong or carries without need at `REVISION`, each with
 * the change that would fix it. Patches are cut from the real files; a sketch
 * stands in where the fix needs a decision first.
 */
import type { ReactNode } from "react";
import { PATCHES, type Patch } from "./patches";
import { C } from "./ui";

interface Issue {
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly why: ReactNode;
  readonly fix:
    | { readonly kind: "patch"; readonly patches: readonly Patch[] }
    | { readonly kind: "sketch"; readonly title: string; readonly code: string }
    | { readonly kind: "unused"; readonly exports: readonly (readonly [string, string, number])[] };
}

export const ISSUE_GROUPS: readonly {
  readonly title: string;
  readonly issues: readonly Issue[];
}[] = [
  {
    title: "Correctness",
    issues: [
      {
        name: "advanceStep",
        path: "sdk/advance.ts",
        line: 85,
        why: (
          <>
            <C>nyte.advance</C> rechecks jobs after a park but not delegations. A child that
            answered while the call was parking leaves the run parked, because only the runner's{" "}
            <C>wake</C> calls <C>delegation.recheck</C>.
          </>
        ),
        fix: { kind: "patch", patches: PATCHES.advanceStep },
      },
      {
        name: "respond",
        path: "step.ts",
        line: 728,
        why: (
          <>
            A lost CAS on <C>refs/chains/&lt;root&gt;</C> means another continuation of the chain
            reserved first. It does not mean the ceiling was reached, yet the run fails as{" "}
            <C>step ceiling</C>, even at 3 of 50.
          </>
        ),
        fix: { kind: "patch", patches: PATCHES.respond },
      },
      {
        name: "tools",
        path: "step.ts",
        line: 958,
        why: (
          <>
            The step that parks a batch answers <C>waiting</C> without <C>until</C>.{" "}
            <C>advance.ts</C> reads the deadline back from the effects, but the runner arms{" "}
            <C>driveAt</C> only after one more drive, which its own run-ref event triggers.
          </>
        ),
        fix: { kind: "patch", patches: PATCHES.tools },
      },
      {
        name: "retrySchedule",
        path: "turn.ts",
        line: 697,
        why: (
          <>
            <C>phase.at</C> is stamped from <C>Date.now()</C>, but <C>advance</C> compares it with
            the step's injected <C>now</C>. A host or test with its own clock retries early or late.
          </>
        ),
        fix: { kind: "patch", patches: PATCHES.retrySchedule },
      },
    ],
  },
  {
    title: "Cost",
    issues: [
      {
        name: "untilLeaseReleased",
        path: "sdk/wait.ts",
        line: 23,
        why: (
          <>
            <C>runs.wait</C> polls the head lease every 5 ms. A lease left by a crashed host lives
            out its 30 s TTL, which costs about 6,000 reads. Backing off to 1 s bounds the reads, at
            the price of noticing a release up to 1 s late.
          </>
        ),
        fix: { kind: "patch", patches: PATCHES.untilLeaseReleased },
      },
      {
        name: "cancelledSet",
        path: "queue.ts",
        line: 290,
        why: (
          <>
            Nothing deletes <C>refs/cancelled/*</C>, and every <C>pendingIn</C> lists every
            tombstone in the session. A landing could clear the tombstones its base passes, but{" "}
            <C>pendingIn</C> drops them before <C>land</C> sees them, and <C>cancel</C> must first
            decide what it answers for a tombstone that is gone.
          </>
        ),
        fix: {
          kind: "sketch",
          title: "Clear passed tombstones in the landing CAS",
          code: `// queue.ts: pendingIn reports the tombstones it skipped, not only the changes it kept
const { changes, skipped } = await pendingIn(session, { head, delivery });

// step.ts, land(): in the landing CAS, clear each skipped tombstone the new base passes
...skipped
  .filter((tombstone) => tombstone.before(last.oid))
  .map((tombstone) => ({ name: tombstone.ref, from: tombstone.oid, to: null })),`,
        },
      },
    ],
  },
  {
    title: "Cleanup",
    issues: [
      {
        name: "decide",
        path: "admission.ts",
        line: 52,
        why: (
          <>
            The <C>fresh</C> and <C>idle</C> branches repeat about 40 lines and differ only on{" "}
            <C>passive</C>. Folded, the whole admission table fits on one screen.
          </>
        ),
        fix: {
          kind: "sketch",
          title: "decide, folded",
          code: `export function decide(head: Head, lead: Lead, agentChanged: boolean): Decision {
  if (head.kind === "settling" || lead.kind === "none") return { kind: "wait" };
  if (head.kind === "live") return { kind: agentChanged ? "handoff" : "join", run: head.run };

  switch (lead.kind) {
    case "passive":
      return head.kind === "idle" ? { kind: "settle", run: head.last } : { kind: "wait" };
    case "report":
      return { kind: "wait" };
    case "user":
      return { kind: "start", origin: { kind: "user" }, chain: { kind: "new" } };
    case "answer": {
      const { authorization } = lead;

      return authorization.kind === "authorized"
        ? {
            kind: "start",
            origin: authorization.origin,
            chain: { kind: "inherit", root: authorization.root, consume: authorization.consume },
          }
        : { kind: "wait" };
    }
  }
}`,
        },
      },
      {
        name: "headFromRunRef",
        path: "sdk/runner.ts",
        line: 50,
        why: (
          <>
            <C>names.ts</C> builds run and effect refs but parses neither. Run refs are parsed by
            hand in <C>runner.ts</C>, <C>events.ts</C> and <C>session-pool.ts</C>, effect refs in{" "}
            <C>runner.ts</C> and <C>events.ts</C>, each with its own copy of the prefix.
          </>
        ),
        fix: { kind: "patch", patches: PATCHES.headFromRunRef },
      },
      {
        name: "projectRef",
        path: "sdk/events.ts",
        line: 336,
        why: (
          <>
            The <C>refs/keys/</C> branch returns the same <C>[]</C> as the fall-through below it.
          </>
        ),
        fix: { kind: "patch", patches: PATCHES.projectRef },
      },
      {
        name: "clearEffects",
        path: "effects.ts",
        line: 366,
        why: (
          <>
            These exports have no callers outside tests. <C>collect</C> and <C>trimStream</C> are
            the kernel's only retention, so no host trims the event log or sweeps objects.
          </>
        ),
        fix: {
          kind: "unused",
          exports: [
            ["clearEffects", "effects.ts", 366],
            ["nextToLand", "queue.ts", 523],
            ["NextChange", "queue.ts", 41],
            ["CHAIN_PREFIX", "names.ts", 193],
            ["advanceBase", "stacks.ts", 294],
            ["stackStatus", "stacks.ts", 281],
            ["collect", "gc.ts", 83],
            ["trimStream", "gc.ts", 116],
          ],
        },
      },
      {
        name: "Run.attempts",
        path: "model.ts",
        line: 100,
        why: (
          <>
            The comment calls <C>attempts</C> the step ceiling. The ceiling reads{" "}
            <C>refs/chains/&lt;root&gt;</C>; <C>attempts</C> only keys deltas.
          </>
        ),
        fix: { kind: "patch", patches: PATCHES.attempts },
      },
    ],
  },
];
