/**
 * app sidebar | Reviews list | review panel (Activity · Guide · Diff) | side chat
 *
 * The agent and CI move on the clock. Your steps are real controls: read the
 * Guide, mark files reviewed, select lines and send them to the side chat,
 * approve, merge. The clock holds on green checks until you merge.
 *
 * Asking for a change from the side chat plays the branch round trip: Nyte
 * saves your uncommitted work, switches to the PR branch, edits, tests,
 * pushes, switches back and restores it. The diff marks what it touched.
 */
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState, type ReactElement } from "react";
import type { ToolClass, TurnPart } from "@nyte-ai/protocol";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import type { RenderedTurn } from "@nyte-ai/app/conversation/transcript-rows.ts";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Tabs } from "@nyte-ai/ui/tabs";
import { ramp, t } from "@nyte-ai/ui/vars.stylex";
import {
  parsePatch,
  referenceLabel,
  type CodeReference,
  type ReviewedState,
  type ReviewFile,
} from "./code";
import { DiffStack } from "./diff-stack";
import { Guide, type GuideSection } from "./guide";
import { usePlayback } from "./playback";
import { ReviewList, type LiveStatus, type ReviewRow } from "./reviews";
import { SideChat } from "./side-chat";
import {
  AGENT,
  BASE,
  CHILD,
  COMMITS,
  FOLLOW_UP,
  HEAD,
  ISSUE,
  MERGE_REQUEST,
  OTHER_SESSION,
  PAIRING_PATH,
  PAIRING_TEST_PATH,
  PIPELINES,
  jobState,
  patchBetween,
  pipelineState,
  tipsAt,
  type JobState,
  type Pipeline,
} from "./scenario";

const READY_AT = 41.5;
const MERGED_AT = 42;
const CHECKOUT = "feat/settings-sync";

const FILES = [
  { path: PAIRING_PATH, category: "implementation" },
  { path: PAIRING_TEST_PATH, category: "test" },
] as const;

type Tab = "activity" | "guide" | "diff";

/** Wall-clock milliseconds since you sent the follow-up, which runs on real time, not the story's clock. */
interface FollowUp {
  readonly sentAt: number;
  readonly text: string;
  readonly references: readonly CodeReference[];
}

const PUSHED_MS = 6600;
const CHECKS_MS = 6000;
const AWAY = { from: 2600, to: 7500 } as const;
const DONE_MS = 7900;

interface Pull {
  readonly base: string;
  readonly tip: string;
  readonly commits: readonly {
    readonly oid: string;
    readonly subject: string;
    readonly parent: string;
  }[];
  readonly conflicted: boolean;
  readonly checks: JobState | "pending" | "none";
  /** 0 to 1 through the follow-up's checks, when they are the current ones. */
  readonly followUpChecks: number | undefined;
  readonly merged: boolean;
}

function pullAt(time: number, merged: boolean, elapsed: number | undefined): Pull {
  const pushed = elapsed !== undefined && elapsed >= PUSHED_MS;
  const carried = time >= 33;
  const tip = pushed ? FOLLOW_UP.oid : tipsAt(time).head;
  const history = COMMITS.filter(
    (commit) =>
      commit.on === "head" &&
      commit.at <= time &&
      (carried ? commit.oid === "e1f4b62" : commit.oid !== "e1f4b62"),
  );
  const commits = pushed ? [...history, FOLLOW_UP] : history;
  const pipeline = PIPELINES.find((entry) => entry.commit === tip);
  const progress =
    pushed && elapsed !== undefined ? Math.min(1, (elapsed - PUSHED_MS) / CHECKS_MS) : undefined;

  return {
    base: carried ? "b7d0f13" : "7c21f0a",
    tip,
    commits,
    conflicted: time >= 22 && time < 33,
    checks:
      progress !== undefined
        ? progress < 1
          ? "running"
          : "passed"
        : commits.length === 0
          ? "none"
          : pipeline === undefined || time < pipeline.at
            ? "pending"
            : pipelineState(pipeline, time),
    followUpChecks: progress,
    merged: merged || time >= MERGED_AT,
  };
}

function filesOf(pull: Pull, commit: string | undefined): readonly ReviewFile[] {
  const picked = pull.commits.find((entry) => entry.oid === commit);
  const from = picked?.parent ?? pull.base;
  const to = picked?.oid ?? pull.tip;

  if (pull.commits.length === 0) return [];

  return FILES.flatMap(({ path, category }) => {
    const patch = patchBetween(from, to, path);

    return patch === undefined
      ? []
      : [
          {
            ...patch,
            path,
            category,
            from,
            to,
            metadata: parsePatch(patch.patch, `${from}:${to}:${path}`),
          },
        ];
  });
}

/** Regenerated for every head: what each part does, then what follows from it. */
function guideFor(tip: string): readonly GuideSection[] {
  const refresh: GuideSection =
    tip === "7c21f0a" || tip === "a41c9e2" || tip === "c5e8d17"
      ? {
          title: "Refresh on wake",
          explanation:
            tip === "a41c9e2"
              ? "start() now runs an interval and listens for powerMonitor's resume event, and both call refresh(). A code that lapsed while the Mac slept is replaced the moment it wakes; a valid code stays put."
              : "start() now runs an interval and listens for powerMonitor's resume event, and both call refresh(). A code is expired from its deadline onward, so waking on that exact tick replaces it.",
          paths: [PAIRING_PATH],
        }
      : {
          title: "Refresh on wake, through the injected clock",
          explanation: `start() keeps ${BASE}'s injected clock and swaps its one-shot timeout for an interval; resume also calls refresh(). refresh() reads that same clock, so anything that drives the clock drives expiry too.`,
          paths: [PAIRING_PATH],
        };

  return [
    refresh,
    {
      title: "Resume test",
      explanation:
        tip === FOLLOW_UP.oid
          ? "The test sets the injected clock to the deadline, emits resume, and expects a new code, so it exercises the same clock the code reads."
          : "The test moves the system time to the deadline, emits resume, and expects a new code.",
      paths: [PAIRING_TEST_PATH],
    },
  ];
}

function tool(
  callId: string,
  at: number,
  now: number,
  klass: ToolClass,
  done: number,
  output: string,
  isError = false,
): TurnPart {
  return {
    kind: "tool",
    callId,
    at,
    class: klass,
    ...(now >= done ? { result: { commit: `${callId}-result`, output, isError } } : {}),
  };
}

function patchClass(from: string, to: string, path: string): ToolClass {
  const patch = patchBetween(from, to, path);

  return {
    kind: "file_patch",
    op: "edit",
    path: `/Users/lab/nyte/${path}`,
    added: patch?.added ?? 0,
    removed: patch?.removed ?? 0,
    patch: patch?.patch ?? "",
  };
}

const shell = (command: string): ToolClass => ({ kind: "shell", command });
const custom = (label: string): ToolClass => ({ kind: "custom", label });

/** The PR's session: the automation run on the story clock. */
function automationTurn(time: number): RenderedTurn {
  const parts: TurnPart[] = [
    {
      kind: "user",
      commit: "ask",
      parent: null,
      content: `Fix ${ISSUE.id}: the pairing code expires while the Mac sleeps. Open a PR and get it green.`,
      at: 0,
    },
    tool("edit-1", 0.3, time, patchClass("7c21f0a", "a41c9e2", PAIRING_PATH), 1.4, "Edited"),
    tool("edit-2", 1.5, time, patchClass("7c21f0a", "a41c9e2", PAIRING_TEST_PATH), 2.8, "Edited"),
    tool(
      "commit-1",
      3,
      time,
      shell(
        `git commit -m "fix(desktop): refresh pairing code after wake" && git push -u origin ${HEAD}`,
      ),
      3.4,
      `[${HEAD} a41c9e2] fix(desktop): refresh pairing code after wake`,
    ),
    tool(
      "pr",
      4,
      time,
      shell("gh pr create --fill --base main"),
      4.6,
      "https://github.com/nyte-ai/nyte/pull/311",
    ),
    tool("wait-1", 5, time, custom("Wait for checks"), 13.5, "Pipeline #1 failed: test desktop"),
    tool(
      "log",
      14,
      time,
      shell("gh run view --log-failed"),
      14.6,
      " ✗ pairing › refreshes an expired code on resume\n   AssertionError: expected 'K7Q-29X' not to be 'K7Q-29X'\n   ❯ src/pairing.test.ts:26:37",
    ),
    tool("edit-3", 15.5, time, patchClass("a41c9e2", "c5e8d17", PAIRING_PATH), 16.8, "Edited"),
    tool(
      "commit-2",
      17,
      time,
      shell(`git commit -am "fix(desktop): treat a code as expired at its deadline" && git push`),
      17.4,
      `[${HEAD} c5e8d17] fix(desktop): treat a code as expired at its deadline`,
    ),
    tool("wait-2", 18, time, custom("Wait for checks"), 26, "Pipeline #2 passed"),
    tool(
      "mergeable",
      27,
      time,
      shell(`gh pr view ${MERGE_REQUEST.number} --json mergeable`),
      27.5,
      `{ "mergeable": "CONFLICTING" }`,
    ),
    tool(
      "merge-tree",
      28.5,
      time,
      shell(`git merge-tree --write-tree origin/${BASE} HEAD`),
      29,
      `CONFLICT (content): Merge conflict in ${PAIRING_PATH}`,
      true,
    ),
    tool(
      "delegate",
      30,
      time,
      custom(`Delegate: ${CHILD.name}`),
      33.5,
      "Pushed e1f4b62 on b7d0f13, importing a41c9e2 and c5e8d17.",
    ),
    tool("wait-3", 34, time, custom("Wait for checks"), READY_AT, "Pipeline #3 passed"),
  ];

  if (time >= 41.6)
    parts.push({
      kind: "assistant",
      commit: "ready",
      contentIndex: 0,
      text: `!${MERGE_REQUEST.number} is green on e1f4b62 and waiting for your review. The conflict was with ${OTHER_SESSION.author.toLowerCase()}: I kept ${BASE}'s injected clock and moved refresh() onto it too, which git did not flag.`,
      at: 41.6,
    });

  return {
    kind: "turn",
    id: "automation",
    run: { kind: "none" },
    startedAt: 0,
    durationMs: 41_600,
    parts: parts.filter((part) => part.at <= time),
  };
}

/** Your request from the side chat, played on real time. */
function followUpTurn(followUp: FollowUp, elapsed: number): RenderedTurn {
  const ms = (offset: number): number => offset / 1000;
  const now = ms(elapsed);
  const reference = followUp.references.map((entry) => `@${referenceLabel(entry)}`);
  const parts: TurnPart[] = [
    {
      kind: "user",
      commit: "follow-up",
      parent: null,
      content: [followUp.text, ...reference].filter((line) => line !== "").join("\n"),
      at: 0,
    },
    tool(
      "status",
      ms(600),
      now,
      shell("git status --short --branch"),
      ms(900),
      `## ${CHECKOUT}...origin/${CHECKOUT}\n M packages/app/src/chrome/settings-navigation.tsx`,
    ),
    tool(
      "stash",
      ms(1300),
      now,
      shell(`git stash push --include-untracked --message "nyte: before ${HEAD}"`),
      ms(1700),
      `Saved working directory and index state On ${CHECKOUT}: nyte: before ${HEAD}`,
    ),
    tool(
      "switch",
      ms(2100),
      now,
      shell(`git switch ${HEAD} && git pull --ff-only`),
      ms(AWAY.from),
      `Switched to branch '${HEAD}'\nAlready up to date.`,
    ),
    tool(
      "edit",
      ms(3000),
      now,
      patchClass("e1f4b62", FOLLOW_UP.oid, PAIRING_TEST_PATH),
      ms(3900),
      "Edited",
    ),
    tool(
      "test",
      ms(4300),
      now,
      shell("pnpm --dir packages/desktop test pairing"),
      ms(5600),
      " ✓ src/pairing.test.ts (3 tests) 12ms\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)",
    ),
    tool(
      "push",
      ms(6000),
      now,
      shell(`git commit -am "${FOLLOW_UP.subject}" && git push`),
      ms(PUSHED_MS),
      `[${HEAD} ${FOLLOW_UP.oid}] ${FOLLOW_UP.subject}\n   e1f4b62..${FOLLOW_UP.oid}  ${HEAD} -> ${HEAD}`,
    ),
    tool(
      "return",
      ms(7000),
      now,
      shell(`git switch ${CHECKOUT} && git stash pop`),
      ms(AWAY.to),
      `Switched to branch '${CHECKOUT}'\nChanges not staged for commit:\n\tmodified:   packages/app/src/chrome/settings-navigation.tsx\nDropped refs/stash@{0}`,
    ),
  ];

  if (elapsed >= DONE_MS)
    parts.push({
      kind: "assistant",
      commit: "follow-up-done",
      contentIndex: 0,
      text: `Pushed ${FOLLOW_UP.oid} to ${HEAD}: the resume test now drives the injected clock instead of fake timers. You're back on ${CHECKOUT} with your change to settings-navigation.tsx restored.`,
      at: ms(DONE_MS),
    });

  return {
    kind: "turn",
    id: "follow-up",
    run: { kind: "none" },
    startedAt: 0,
    durationMs: Math.min(elapsed, DONE_MS),
    parts: parts.filter((part) => part.at <= now),
  };
}

interface Activity {
  readonly at: string;
  readonly icon: IconName;
  readonly title: string;
  readonly detail?: string;
}

const STORY_ACTIVITY: readonly (Activity & { readonly time: number })[] = [
  {
    time: 3,
    at: "0:03",
    icon: "git",
    title: `${AGENT.name} pushed a41c9e2`,
    detail: "fix(desktop): refresh pairing code after wake",
  },
  {
    time: 4,
    at: "0:04",
    icon: "pull-request",
    title: `${AGENT.name} opened !${MERGE_REQUEST.number} and requested your review`,
    detail: `On behalf of you · ${AGENT.model}`,
  },
  {
    time: 13,
    at: "0:13",
    icon: "circle-x",
    title: "test desktop failed on a41c9e2",
    detail: "1 of 87 tests",
  },
  {
    time: 17,
    at: "0:17",
    icon: "git",
    title: `${AGENT.name} pushed c5e8d17`,
    detail: "fix(desktop): treat a code as expired at its deadline",
  },
  {
    time: 22,
    at: "0:22",
    icon: "warning",
    title: `This branch has conflicts with ${BASE}`,
    detail: `b7d0f13 · ${OTHER_SESSION.title}`,
  },
  { time: 26, at: "0:26", icon: "checkmark", title: "Checks passed on c5e8d17", detail: "5 of 5" },
  {
    time: 30,
    at: "0:30",
    icon: "robot",
    title: `${AGENT.name} delegated ${CHILD.name}`,
    detail: PAIRING_PATH,
  },
  {
    time: 33,
    at: "0:33",
    icon: "git",
    title: `${CHILD.name} force-pushed c5e8d17 → e1f4b62`,
    detail: "Parent b7d0f13 · imports a41c9e2, c5e8d17",
  },
  {
    time: READY_AT,
    at: "0:41",
    icon: "checkmark",
    title: "Checks passed on e1f4b62",
    detail: "5 of 5",
  },
];

function JobLeading({ state }: { readonly state: JobState }): ReactElement | null {
  if (state === "running") return <Spinner />;
  if (state === "failed") return <StatusDot mark="failed" />;
  if (state === "skipped") return <Icon name="arrow-right" size={14} />;
  if (state === "queued") return null;

  return <Icon name="checkmark" size={14} xstyle={layout.passed} />;
}

function checksLabel(pull: Pull): string {
  if (pull.checks === "none") return "No checks";
  if (pull.checks === "pending") return "Waiting for checks";
  if (pull.checks === "failed") return "1 failing check";
  if (pull.checks === "passed") return "All checks passed";

  return "Checks running";
}

function ActivityTab({
  pull,
  time,
  approved,
  activity,
}: {
  readonly pull: Pull;
  readonly time: number;
  readonly approved: boolean;
  readonly activity: readonly Activity[];
}): ReactElement {
  const third = PIPELINES[2];
  const followUp: Pipeline | undefined =
    pull.followUpChecks === undefined || third === undefined
      ? undefined
      : { ...third, number: 4, commit: FOLLOW_UP.oid };
  const pipeline =
    followUp ?? PIPELINES.find((entry) => entry.commit === pull.tip && entry.at <= time);
  const clock =
    followUp !== undefined && third !== undefined
      ? third.at + (pull.followUpChecks ?? 0) * 7.5
      : time;

  return (
    <div {...stylex.props(layout.scroll)}>
      <div {...stylex.props(layout.column)}>
        <div {...stylex.props(layout.group)}>
          <Row>
            <Row.Leading>
              <Icon name="git-branch" size={14} />
            </Row.Leading>
            <Row.Label>
              {HEAD} → {BASE}
            </Row.Label>
            <Row.Meta>
              {pull.commits.length} {pull.commits.length === 1 ? "commit" : "commits"}
            </Row.Meta>
          </Row>
          <Row>
            <Row.Leading>
              <Icon name="robot" size={14} />
            </Row.Leading>
            <Row.Label>{AGENT.name}</Row.Label>
            <Row.Meta>On behalf of you · {AGENT.model}</Row.Meta>
          </Row>
        </div>
        <div {...stylex.props(layout.group)}>
          <Row>
            <Row.Label>
              Checks{pipeline === undefined ? "" : ` · #${pipeline.number} on ${pipeline.commit}`}
            </Row.Label>
            <Row.Meta>{checksLabel(pull)}</Row.Meta>
          </Row>
          {pipeline?.jobs.map((job) => {
            const state = jobState(pipeline, job, clock);

            return (
              <Row key={job.name}>
                <Row.Leading>
                  <JobLeading state={state} />
                </Row.Leading>
                <Row.Label>{job.name}</Row.Label>
                <Row.Meta>{state === "passed" || state === "failed" ? job.took : state}</Row.Meta>
              </Row>
            );
          })}
        </div>
        <div {...stylex.props(layout.group)}>
          <Row size="lg">
            <Row.Leading>
              {pull.merged ? (
                <Icon name="merged" size={16} />
              ) : pull.conflicted ? (
                <StatusDot mark="failed" />
              ) : pull.checks === "passed" ? (
                <Icon name="checkmark" size={16} />
              ) : (
                <Spinner />
              )}
            </Row.Leading>
            <Row.Body>
              <Row.Label>
                {pull.merged
                  ? `Merged into ${BASE}`
                  : pull.conflicted
                    ? "This branch has conflicts that must be resolved"
                    : pull.checks === "passed"
                      ? approved
                        ? "Ready to merge"
                        : "Waiting for your review"
                      : checksLabel(pull)}
              </Row.Label>
              <Row.Description>
                {pull.conflicted
                  ? time >= 30
                    ? `${CHILD.name} is resolving ${PAIRING_PATH}`
                    : PAIRING_PATH
                  : `${pull.commits.length} ${pull.commits.length === 1 ? "commit" : "commits"} on ${pull.base}`}
              </Row.Description>
            </Row.Body>
          </Row>
        </div>
        {activity.length > 0 && (
          <div {...stylex.props(layout.group)}>
            <Row>
              <Row.Label>Activity</Row.Label>
            </Row>
            {activity.map((entry) => (
              <Row key={`${entry.at}-${entry.title}`}>
                <Row.Leading>
                  <Icon name={entry.icon} size={14} />
                </Row.Leading>
                <Row.Body>
                  <Row.Label>{entry.title}</Row.Label>
                  {entry.detail !== undefined && <Row.Description>{entry.detail}</Row.Description>}
                </Row.Body>
                <Row.Meta>{entry.at}</Row.Meta>
              </Row>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function liveStatus(pull: Pull, approved: boolean): LiveStatus {
  if (pull.merged) return "merged";
  if (pull.conflicted) return "conflicts";
  if (pull.checks === "failed") return "checks_failed";
  if (pull.checks !== "passed") return "checks_running";

  return approved ? "approved" : "waiting";
}

export function Review(): ReactElement {
  const playback = usePlayback();
  const { time, playing, pause, seek, play, toggle } = playback;
  const [approvedAt, setApprovedAt] = useState<number | undefined>(undefined);
  const [merged, setMerged] = useState(false);
  const [tab, setTab] = useState<Tab>("guide");
  const [layoutMode, setLayoutMode] = useState<"unified" | "split">("unified");
  const [commit, setCommit] = useState<string | undefined>(undefined);
  const [reviewedPatches, setReviewedPatches] = useState<ReadonlyMap<string, string>>(new Map());
  const [collapsedOverride, setCollapsedOverride] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const [focus, setFocus] = useState<{
    readonly path: string | undefined;
    readonly revision: number;
  }>({ path: undefined, revision: 0 });
  const [references, setReferences] = useState<readonly CodeReference[]>([]);
  const [followUp, setFollowUp] = useState<FollowUp | undefined>(undefined);
  const [now, setNow] = useState(() => performance.now());
  const elapsed = followUp === undefined ? undefined : now - followUp.sentAt;
  const pull = pullAt(time, merged, elapsed);
  const approved = approvedAt !== undefined || time >= MERGED_AT;
  const [parsed] = useState(() => new Map<string, readonly ReviewFile[]>());
  const filesFor = (picked: string | undefined): readonly ReviewFile[] => {
    const key = `${pull.base}:${pull.tip}:${pull.commits.length}:${picked ?? "all"}`;
    const known = parsed.get(key);

    if (known !== undefined) return known;

    const made = filesOf(pull, picked);
    parsed.set(key, made);

    return made;
  };
  const files = filesFor(commit);
  const allFiles = filesFor(undefined);
  const ticking = elapsed !== undefined && elapsed <= PUSHED_MS + CHECKS_MS + 200;

  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(performance.now()), 150);

    return () => window.clearInterval(timer);
  }, [ticking]);

  useEffect(() => {
    if (playing && !merged && time >= READY_AT && time < MERGED_AT) {
      seek(READY_AT);
      pause();
    }
  }, [playing, merged, time, seek, pause]);

  useEffect(() => {
    const stops = [0, ...STORY_ACTIVITY.map((entry) => entry.time), MERGED_AT, 43];
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
        return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setLayoutMode((current) => (current === "split" ? "unified" : "split"));
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        toggle();
        return;
      }

      const next =
        event.key === "ArrowRight"
          ? stops.find((stop) => stop > time + 0.01)
          : event.key === "ArrowLeft"
            ? stops.findLast((stop) => stop < time - 0.01)
            : undefined;

      if (next === undefined) return;
      event.preventDefault();
      pause();
      seek(next);
    };
    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [time, toggle, pause, seek]);

  const reviewed = (path: string): ReviewedState => {
    const seen = reviewedPatches.get(path);
    const current = allFiles.find((file) => file.path === path)?.patch;

    if (seen === undefined) return "unreviewed";

    return seen === current ? "reviewed" : "changed";
  };
  const setReviewed = (paths: readonly string[], next: boolean): void => {
    setReviewedPatches((current) => {
      const updated = new Map(current);

      for (const path of paths) {
        const patch = allFiles.find((file) => file.path === path)?.patch;

        if (next && patch !== undefined) updated.set(path, patch);
        else updated.delete(path);
      }

      return updated;
    });
    setCollapsedOverride((current) => {
      const updated = new Map(current);

      for (const path of paths) updated.delete(path);

      return updated;
    });
  };
  const collapsed = (path: string): boolean =>
    collapsedOverride.get(path) ?? reviewed(path) === "reviewed";
  const toggleCollapsed = (path: string): void =>
    setCollapsedOverride(new Map(collapsedOverride).set(path, !collapsed(path)));
  const lastPush = COMMITS.findLast(
    (entry) => entry.on === "head" && entry.at <= time && entry.at > 3,
  );
  const justUpdated = (path: string): boolean => {
    if (elapsed !== undefined && elapsed >= PUSHED_MS)
      return path === FOLLOW_UP.path && reviewed(path) !== "reviewed";
    if (lastPush === undefined || time - lastPush.at > 8) return false;

    return patchBetween(lastPush.parent, lastPush.oid, path) !== undefined;
  };
  const addReference = (reference: CodeReference): void =>
    setReferences((current) =>
      current.some(
        (entry) =>
          entry.path === reference.path &&
          entry.start === reference.start &&
          entry.end === reference.end &&
          entry.side === reference.side,
      )
        ? current
        : [...current, reference],
    );
  const openInDiff = (path: string): void => {
    setTab("diff");
    setFocus({ path, revision: focus.revision + 1 });
  };
  const turns = [
    automationTurn(time),
    ...(followUp === undefined || elapsed === undefined ? [] : [followUpTurn(followUp, elapsed)]),
  ];
  const away = elapsed !== undefined && elapsed >= AWAY.from && elapsed < AWAY.to;
  const activity: Activity[] = [
    ...STORY_ACTIVITY.filter((entry) => entry.time <= time),
    ...(elapsed !== undefined && elapsed >= PUSHED_MS
      ? [
          {
            at: "now",
            icon: "git" as const,
            title: `${AGENT.name} pushed ${FOLLOW_UP.oid}`,
            detail: FOLLOW_UP.subject,
          },
        ]
      : []),
    ...(approvedAt === undefined
      ? []
      : [{ at: "now", icon: "checkmark" as const, title: "You approved these changes" }]),
    ...(pull.merged
      ? [
          {
            at: "0:42",
            icon: "merged" as const,
            title: `You merged !${MERGE_REQUEST.number} into ${BASE}`,
            detail: `b7d0f13 → ${pull.tip}`,
          },
        ]
      : []),
    ...(time >= 43
      ? [{ at: "0:43", icon: "linear" as const, title: `${ISSUE.id} moved to Done` }]
      : []),
  ];
  const mergeable =
    !pull.conflicted && pull.checks === "passed" && approved && !pull.merged && time >= READY_AT;
  const row: ReviewRow = {
    number: MERGE_REQUEST.number,
    title: MERGE_REQUEST.title,
    status: liveStatus(pull, approved),
    author: AGENT.name,
    age: "now",
  };

  return (
    <div {...stylex.props(layout.shell)}>
      <aside {...stylex.props(sidebarStyles.rail)}>
        <div {...stylex.props(sidebarStyles.primaryActions)}>
          <Row variant="nav" xstyle={sidebarStyles.navRow}>
            <Row.Leading>
              <Icon name="inbox-empty" size={14} />
            </Row.Leading>
            <Row.Label>Inbox</Row.Label>
          </Row>
          <Row variant="nav" selected xstyle={sidebarStyles.navRow}>
            <Row.Leading>
              <Icon name="pull-request" size={14} />
            </Row.Leading>
            <Row.Label>Reviews</Row.Label>
          </Row>
          <Row variant="nav" xstyle={sidebarStyles.navRow}>
            <Row.Leading>
              <Icon name="new-chat" size={14} />
            </Row.Leading>
            <Row.Label>Sessions</Row.Label>
          </Row>
        </div>
      </aside>
      <ReviewList current={row} onOpen={() => setTab("guide")} />
      <main {...stylex.props(layout.panel)}>
        <Tabs.Root
          value={tab}
          onValueChange={(next: unknown) =>
            setTab(next === "activity" ? "activity" : next === "diff" ? "diff" : "guide")
          }
          variant="pill"
          xstyle={layout.tabsRoot}
        >
          <div {...stylex.props(layout.bar)}>
            <span {...stylex.props(layout.crumb)}>
              <Icon name="linear" size={13} />
              {ISSUE.id}
              <Icon name="chevron-right" size={11} />
              <Icon name="pull-request" size={13} xstyle={layout.open} />
            </span>
            <span {...stylex.props(layout.barTitle)}>{MERGE_REQUEST.title}</span>
            <span {...stylex.props(layout.spacer)} />
            <Button
              variant="secondary"
              disabled={approved || pull.commits.length === 0}
              onClick={() => setApprovedAt(time)}
            >
              {approved ? "Approved" : "Approve"}
            </Button>
            <Button
              icon="merged"
              disabled={!mergeable}
              onClick={() => {
                setMerged(true);
                seek(MERGED_AT);
                play();
              }}
            >
              {pull.merged ? "Merged" : "Merge"}
            </Button>
          </div>
          <div {...stylex.props(layout.tabs)}>
            <Tabs.List aria-label="Review">
              <Tabs.Tab value="activity">Activity</Tabs.Tab>
              <Tabs.Tab value="guide">Guide</Tabs.Tab>
              <Tabs.Tab value="diff">Diff</Tabs.Tab>
            </Tabs.List>
          </div>
          <Tabs.Panel value="activity" xstyle={layout.tabPanel}>
            <ActivityTab pull={pull} time={time} approved={approved} activity={activity} />
          </Tabs.Panel>
          <Tabs.Panel value="guide" xstyle={layout.tabPanel}>
            {allFiles.length === 0 ? (
              <p {...stylex.props(layout.empty)}>
                The guide is written once the branch has a commit.
              </p>
            ) : (
              <Guide
                heading={{
                  title: MERGE_REQUEST.title,
                  author: AGENT.name,
                  number: `nyte#${MERGE_REQUEST.number}`,
                  base: BASE,
                  head: HEAD,
                }}
                sections={guideFor(pull.tip)}
                files={allFiles}
                reviewed={reviewed}
                onReviewed={(path, next) => setReviewed([path], next)}
                collapsed={collapsed}
                onToggle={toggleCollapsed}
                justUpdated={justUpdated}
                onOpenInDiff={openInDiff}
                onReference={addReference}
              />
            )}
          </Tabs.Panel>
          <Tabs.Panel value="diff" xstyle={layout.tabPanel}>
            <DiffStack
              files={files}
              commits={pull.commits}
              commit={commit}
              onCommit={setCommit}
              layout={layoutMode}
              onLayout={setLayoutMode}
              reviewed={reviewed}
              onReviewed={setReviewed}
              collapsed={collapsed}
              onToggle={toggleCollapsed}
              justUpdated={justUpdated}
              focus={focus}
              onReference={addReference}
            />
          </Tabs.Panel>
        </Tabs.Root>
      </main>
      <SideChat
        title={`${ISSUE.id} · !${MERGE_REQUEST.number}`}
        turns={turns}
        running={followUp === undefined ? playing && time < READY_AT : (elapsed ?? 0) < DONE_MS}
        checkout={CHECKOUT}
        agentBranch={away ? HEAD : undefined}
        references={references}
        onRemoveReference={(index) =>
          setReferences(references.filter((_, position) => position !== index))
        }
        canSend={followUp === undefined && time >= 33 && !pull.merged}
        working={followUp === undefined ? playing && time < READY_AT : (elapsed ?? 0) < DONE_MS}
        onSend={(text) => {
          setFollowUp({ sentAt: performance.now(), text, references });
          setNow(performance.now());
          setReferences([]);
        }}
      />
    </div>
  );
}

const layout = stylex.create({
  shell: {
    display: "flex",
    width: "100%",
    height: "100%",
    minHeight: 0,
    backgroundColor: t.sidebarMaterial,
    color: t.contentPrimary,
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
  },
  tabsRoot: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingInline: 14,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.borderSecondaryTranslucent,
    flexShrink: 0,
  },
  crumb: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: t.contentSecondary,
    fontSize: t.fontSm,
    flexShrink: 0,
  },
  open: { color: ramp.green80 },
  barTitle: {
    minWidth: 0,
    overflow: "hidden",
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  spacer: { flex: 1 },
  tabs: { display: "flex", paddingInline: 14, paddingBlock: 10, flexShrink: 0 },
  tabPanel: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  empty: { margin: 0, padding: 28, color: t.contentSecondary },
  scroll: { flex: 1, minHeight: 0, overflowY: "auto" },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    paddingInline: 12,
    paddingBlock: "4px 24px",
  },
  group: { display: "flex", flexDirection: "column", gap: 2 },
  passed: { color: ramp.green80 },
});
