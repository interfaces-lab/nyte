/**
 * The Changes tab's commit surface: a message field and one primary action
 * with the rest of the Git actions behind its menu.
 *
 * Every action here is a host mutation, so each one is gated on workspace
 * trust and each outcome is reported in plain words instead of being retried
 * silently. Nothing is ever forced: a rejected push asks for a pull, an
 * untracked branch offers to publish itself, and a missing `gh` says so.
 *
 * The surface belongs to the working tree. A turn's changes and a commit's are
 * records of an edit, so the bar is not rendered for those scopes at all.
 */
import { create, props } from "@stylexjs/stylex";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type {
  GitHubPullRequestInput,
  GitHubPullRequestOutcome,
  GitHubState,
  GitOutcome,
  GitRevision,
} from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { useGitHub, useGitHubState } from "../chrome/github-account.ts";
import { errorMessage } from "../errors.ts";
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { Button, ButtonLink, SplitButton } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { openExternal } from "../open-external.ts";
import { keys, queryClient, refreshVcs, workspaceGit } from "../queries.ts";
import { intent } from "@nyte-ai/ui/surface-theme";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import type { BranchReadout } from "./change-scopes.ts";
import { ChangesPullRequest } from "./changes-pull-request.tsx";
import type { WorkbenchChangesScope } from "./controller.ts";

/** Every action the split button can run, in the order the menu lists them. */
export const COMMIT_ACTIONS = [
  "branch-commit",
  "branch-commit-push",
  "branch",
  "commit",
  "commit-push",
  "commit-pull-request",
  "push",
  "pull-request",
] as const;

type CommitAction = (typeof COMMIT_ACTIONS)[number];

/** The default action before the user chooses one from the menu. */
const DEFAULT_COMMIT_ACTION: CommitAction = "commit-push";

const STORAGE_KEY = "nyte.desktop.changes-commit-action.v1";

/** Which steps one action runs, in order. A pull request always pushes its branch first. */
interface CommitActionPlan {
  readonly branch: boolean;
  readonly commit: boolean;
  readonly push: boolean;
  readonly pullRequest: boolean;
}

function commitActionPlan(action: CommitAction): CommitActionPlan {
  const steps = { branch: false, commit: false, push: false, pullRequest: false };

  switch (action) {
    case "branch-commit":
      return { ...steps, branch: true, commit: true };
    case "branch-commit-push":
      return { ...steps, branch: true, commit: true, push: true };
    case "branch":
      return { ...steps, branch: true };
    case "commit":
      return { ...steps, commit: true };
    case "commit-push":
      return { ...steps, commit: true, push: true };
    case "commit-pull-request":
      return { ...steps, commit: true, push: true, pullRequest: true };
    case "push":
      return { ...steps, push: true };
    case "pull-request":
      return { ...steps, push: true, pullRequest: true };
  }
}

/** The actions this host offers; pull requests need GitHub. */
export function commitActions(pullRequests: boolean): readonly CommitAction[] {
  return pullRequests
    ? COMMIT_ACTIONS
    : COMMIT_ACTIONS.filter((action) => !commitActionPlan(action).pullRequest);
}

/** Menu groups: actions that branch first, then commits, then pushes and pull requests. */
function commitActionGroup(action: CommitAction): "branch" | "commit" | "push" {
  const plan = commitActionPlan(action);

  if (plan.branch) return "branch";

  return plan.commit ? "commit" : "push";
}

function commitActionLabel(action: CommitAction): string {
  switch (action) {
    case "branch-commit":
      return "Create Branch and Commit Changes…";
    case "branch-commit-push":
      return "Create Branch, Commit and Push…";
    case "branch":
      return "Create Branch…";
    case "commit":
      return "Commit Changes";
    case "commit-push":
      return "Commit and Push Changes";
    case "commit-pull-request":
      return "Commit and Create Pull Request";
    case "push":
      return "Push Branch";
    case "pull-request":
      return "Create Pull Request";
  }
}

/** The scopes that read the working tree, which is the only place a commit applies. */
export function readsWorkingTree(scope: WorkbenchChangesScope): boolean {
  return scope.kind === "uncommitted" || scope.kind === "staged" || scope.kind === "unstaged";
}

interface CommitBarState {
  readonly scope: WorkbenchChangesScope;
  /** Files in the scope on screen; nothing to commit while this is zero. */
  readonly fileCount: number;
  readonly message: string;
  readonly branch: BranchReadout | undefined;
  /** GitHub as the host last read it; undefined until it answers. */
  readonly github: GitHubState | undefined;
}

/** Why GitHub cannot open a pull request yet, read from its state before anything runs. */
function pullRequestBlocker(github: GitHubState | undefined): string | undefined {
  switch (github?.kind) {
    case undefined:
    case "signing_in":
      return undefined;
    case "cli_missing":
      return "Install the GitHub CLI (gh) to open pull requests";
    case "signed_out":
      return "Sign in to the GitHub CLI to open pull requests";
    case "error":
      return github.message;
    case "ready":
      return github.repository === undefined ? "This repository has no GitHub remote" : undefined;
  }
}

/**
 * Why an action cannot run, when the bar does not already show it. An action that
 * creates a branch first leaves a detached or unborn HEAD behind, so those
 * checks apply only to the actions that push or open a pull request as they stand.
 */
function commitActionDisabledReason(
  action: CommitAction,
  state: CommitBarState,
): string | undefined {
  const plan = commitActionPlan(action);

  if (plan.pullRequest && !readsWorkingTree(state.scope))
    return "Pull requests apply to the working tree";

  const blocker = plan.pullRequest ? pullRequestBlocker(state.github) : undefined;

  if (blocker !== undefined) return blocker;

  if (plan.branch) return undefined;

  if (plan.push && state.branch?.kind === "detached")
    return "HEAD is detached, so there is no branch";

  if (plan.push && !plan.commit && state.branch?.kind === "unborn")
    return "This branch has no commits yet";

  return undefined;
}

function commitActionDisabled(action: CommitAction, state: CommitBarState): boolean {
  return (
    (commitActionPlan(action).commit && (state.fileCount === 0 || state.message.trim() === "")) ||
    commitActionDisabledReason(action, state) !== undefined
  );
}

/** What a step left behind, as the bar reports it. */
interface CommitBarResult {
  readonly tone: "success" | "error";
  readonly text: string;
  /** Git's or `gh`'s own words, kept so nothing is lost to paraphrase. */
  readonly detail?: string;
  readonly url?: string;
  /** The branch tracks nothing, so the bar offers to publish it. */
  readonly offerPublish?: boolean;
}

function refusedMessage(
  result: Exclude<GitOutcome, { readonly kind: "applied" }>,
  what: string,
): CommitBarResult {
  switch (result.kind) {
    case "unchanged":
      return { tone: "error", text: `${what}: nothing to do.` };
    case "stale":
      return { tone: "error", text: "Changes changed. Review them and try again." };
    case "busy":
      return { tone: "error", text: "A run is still writing to this workspace." };
    case "rejected":
      return { tone: "error", text: `${what} didn’t go through.`, detail: result.reason };
    default: {
      const _exhaustive: never = result;

      return _exhaustive;
    }
  }
}

function createBranchResultMessage(result: GitOutcome, name: string): CommitBarResult {
  return result.kind === "applied"
    ? { tone: "success", text: `Created branch ${name} and switched to it.` }
    : refusedMessage(result, `Creating ${name}`);
}

function commitResultMessage(result: GitOutcome): CommitBarResult {
  return result.kind === "applied"
    ? { tone: "success", text: "Committed." }
    : result.kind === "unchanged"
      ? { tone: "error", text: "Nothing to commit." }
      : refusedMessage(result, "The commit");
}

function pushResultMessage(result: GitOutcome): CommitBarResult {
  return result.kind === "applied"
    ? { tone: "success", text: "Pushed." }
    : result.kind === "unchanged"
      ? { tone: "success", text: "Nothing to push." }
      : refusedMessage(result, "The push");
}

function pullRequestResultMessage(result: GitHubPullRequestOutcome): CommitBarResult {
  switch (result.kind) {
    case "created":
      return { tone: "success", text: "Opened a pull request.", url: result.url };
    case "exists":
      return {
        tone: "success",
        text: `A pull request is already open for this branch: #${String(result.pullRequest.number)} ${result.pullRequest.title}`,
        url: result.pullRequest.url,
      };
    case "cli_missing":
      return {
        tone: "error",
        text: "Pull requests need the GitHub CLI. Install gh, then try again.",
      };
    case "signed_out":
      return {
        tone: "error",
        text: "The GitHub CLI is signed out. Run gh auth login, then try again.",
      };
    case "no_remote":
      return {
        tone: "error",
        text: "This repository has no GitHub remote to open a pull request against.",
      };
    case "detached":
      return {
        tone: "error",
        text: "HEAD is detached, so there is no branch to open a pull request from.",
      };
    case "failed":
      return { tone: "error", text: "Couldn’t open the pull request.", detail: result.message };
  }
}

/** A trust refusal crosses IPC as a `forbidden` failure, not as an outcome. */
const trustRefusal = Type.Object({ cause: Type.Object({ code: Type.Literal("forbidden") }) });

function actionFailureMessage(cause: unknown): CommitBarResult {
  if (Value.Check(trustRefusal, cause))
    return {
      tone: "error",
      text: "Trust this workspace to let Nyte write to Git, then try again.",
    };

  return { tone: "error", text: "The action didn’t go through.", detail: errorMessage(cause) };
}

/**
 * What a commit covers. The staged scope commits the index as it stands;
 * every other working-tree scope commits each tracked change with it.
 */
function commitTargetFor(scope: WorkbenchChangesScope): "staged" | "all" {
  return scope.kind === "staged" ? "staged" : "all";
}

/** The message's first line titles the pull request and the rest is its body; without a message `gh` fills both from the commits. */
function pullRequestInput(message: string): GitHubPullRequestInput {
  const [first = "", ...rest] = message.split("\n");
  const title = first.trim();
  const body = rest.join("\n").trim();

  if (title === "") return {};

  return body === "" ? { title } : { title, body };
}

function readStoredAction(actions: readonly CommitAction[]): CommitAction {
  try {
    if (typeof window === "undefined") return DEFAULT_COMMIT_ACTION;
    const stored = window.localStorage.getItem(STORAGE_KEY);

    return actions.find((action) => action === stored) ?? DEFAULT_COMMIT_ACTION;
  } catch {
    return DEFAULT_COMMIT_ACTION;
  }
}

/** Remembering the last action is a convenience, never a reason to fail one. */
function storeAction(action: CommitAction): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, action);
  } catch {}
}

const styles = create({
  bar: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1_5,
    flexShrink: 0,
    padding: space.s2,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  actions: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  branchField: { flex: 1 },
  primary: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  result: {
    display: "flex",
    flexDirection: "column",
    gap: space.s0_5,
    color: role.contentSecondary,
    textWrap: "pretty",
  },
  resultError: { color: role.contentSecondary },
  resultDetail: { color: role.contentSecondary },
  blocked: { margin: 0 },
  resultActions: { display: "flex", alignItems: "center", gap: space.s2, flexWrap: "wrap" },
});

interface ChangesCommitBarProps {
  readonly scope: WorkbenchChangesScope;
  readonly branch: BranchReadout | undefined;
  readonly revision: string;
  readonly fileCount: number;
  /** Opens a pull request or check page; the system browser when absent. */
  readonly onOpenLink?: (url: string) => void;
}

interface RunOptions {
  readonly branchName?: string;
  readonly setUpstream?: boolean;
  /** A retry continues an action whose earlier steps already ran. */
  readonly skipBranch?: boolean;
  readonly skipCommit?: boolean;
}

/** The branch prompt stays until the branch exists, so a taken or invalid name can be corrected without retyping either field. */
export function ChangesCommitBar({
  scope,
  branch,
  revision,
  fileCount,
  onOpenLink = openExternal,
}: ChangesCommitBarProps): ReactElement {
  const github = useGitHub();
  const githubState = useGitHubState(github);
  const actions = commitActions(github !== undefined);
  const [message, setMessage] = useState("");
  const [chosenAction, setAction] = useState<CommitAction>(() => readStoredAction(COMMIT_ACTIONS));
  const action = actions.includes(chosenAction) ? chosenAction : DEFAULT_COMMIT_ACTION;
  const [branchName, setBranchName] = useState("");
  const [branchPrompt, setBranchPrompt] = useState<CommitAction | undefined>(undefined);
  const branchField = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (branchPrompt !== undefined) branchField.current?.focus();
  }, [branchPrompt]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CommitBarResult | undefined>(undefined);
  const [interrupted, setInterrupted] = useState<CommitAction | undefined>(undefined);

  const state: CommitBarState = { scope, fileCount, message, branch, github: githubState.data };
  const pullRequest =
    githubState.data?.kind === "ready" && githubState.data.pullRequest.kind === "ready"
      ? githubState.data.pullRequest.pullRequest
      : undefined;

  const primaryDisabled =
    commitActionDisabled(action, state) || (branchPrompt !== undefined && branchName.trim() === "");

  const run = async (chosen: CommitAction, options: RunOptions = {}): Promise<void> => {
    if (running) return;
    const plan = commitActionPlan(chosen);
    let expect: GitRevision = asId<"git-revision">(revision);
    setRunning(true);
    setResult(undefined);
    setInterrupted(undefined);
    const reported: string[] = [];

    const settle = (outcome: CommitBarResult): void => {
      setResult(
        reported.length === 0
          ? outcome
          : { ...outcome, text: `${reported.join(" ")} ${outcome.text}` },
      );
    };

    try {
      if (plan.branch && options.skipBranch !== true) {
        const name = options.branchName ?? "";

        const created = await (await workspaceGit()).branch({ name, checkout: true }, { expect });
        const outcome = createBranchResultMessage(created, name);

        if (created.kind !== "applied") {
          settle(outcome);

          return;
        }

        expect = created.revision;

        setBranchPrompt(undefined);
        setBranchName("");
        reported.push(outcome.text);
      }

      if (plan.commit && options.skipCommit !== true) {
        const committed = await (
          await workspaceGit()
        ).commit({ message, files: commitTargetFor(scope) }, { expect });

        const outcome = commitResultMessage(committed);

        if (committed.kind !== "applied") {
          settle(outcome);

          return;
        }

        expect = committed.revision;

        setMessage("");
        reported.push(outcome.text);
      }

      if (plan.push) {
        const pushed = await (
          await workspaceGit()
        ).push({ setUpstream: options.setUpstream === true }, { expect });

        const outcome = pushResultMessage(pushed);

        if (outcome.tone === "error") {
          if (pushed.kind !== "stale") setInterrupted(chosen);
          settle(outcome);

          return;
        }

        reported.push(outcome.text);
        void queryClient.invalidateQueries({ queryKey: keys.github });
      }

      if (plan.pullRequest) {
        if (github === undefined) {
          settle({ tone: "error", text: "Pull requests need GitHub on the server." });

          return;
        }

        const opened = await github.createPullRequest(pullRequestInput(message));

        const outcome = pullRequestResultMessage(opened);

        if (outcome.tone === "success") {
          void refreshVcs();
          void queryClient.invalidateQueries({ queryKey: keys.github });
        }

        settle(outcome);

        return;
      }

      settle({ tone: "success", text: "" });
    } catch (cause) {
      settle(actionFailureMessage(cause));
    } finally {
      setRunning(false);
    }
  };

  const start = (chosen: CommitAction): void => {
    if (running || commitActionDisabled(chosen, state)) return;
    setAction(chosen);
    storeAction(chosen);
    setResult(undefined);

    if (commitActionPlan(chosen).branch) {
      setBranchPrompt(chosen);

      return;
    }

    setBranchPrompt(undefined);
    void run(chosen);
  };

  const confirmBranch = (): void => {
    const pending = branchPrompt;

    if (running || primaryDisabled || pending === undefined) return;
    void run(pending, { branchName: branchName.trim() });
  };

  const publishBranch = (): void => {
    const pending = interrupted ?? "push";
    void run(pending, { setUpstream: true, skipBranch: true, skipCommit: true });
  };

  const blocked = commitActionPlan(action).pullRequest
    ? pullRequestBlocker(githubState.data)
    : undefined;
  const successText = result?.tone === "success" ? result.text.trim() : "";
  const showResult = result !== undefined && (result.tone === "error" || successText !== "");

  return (
    <form
      {...props(styles.bar)}
      onSubmit={(event) => {
        event.preventDefault();

        if (running || primaryDisabled) return;

        if (branchPrompt === undefined) start(action);
        else confirmBranch();
      }}
    >
      <Input
        type="text"
        aria-label="Commit message"
        placeholder="Fix tab close behavior"
        autoComplete="off"
        spellCheck
        value={message}
        readOnly={running}
        onValueChange={setMessage}
      />
      {branchPrompt !== undefined && (
        <div {...props(styles.actions)}>
          <Input
            ref={branchField}
            type="text"
            aria-label="New branch name"
            placeholder="fix/tab-close"
            autoComplete="off"
            spellCheck={false}
            value={branchName}
            readOnly={running}
            xstyle={styles.branchField}
            onValueChange={setBranchName}
            onKeyDown={(event) => {
              if (!running && event.key === "Escape") setBranchPrompt(undefined);
            }}
          />
          <Button loading={running} onClick={() => setBranchPrompt(undefined)}>
            Cancel
          </Button>
        </div>
      )}
      <SplitButton.Root>
        <SplitButton.Main
          type="submit"
          variant="solid"
          disabled={primaryDisabled}
          disabledReason={commitActionDisabledReason(action, state)}
          loading={running}
          xstyle={styles.primary}
        >
          {commitActionLabel(action).replace(/…$/, branchPrompt === undefined ? "…" : "")}
        </SplitButton.Main>
        <Menu>
          <MenuTrigger
            render={
              <SplitButton.MenuTrigger
                variant="solid"
                aria-label="More commit actions"
                loading={running}
              />
            }
          />
          <MenuContent align="end" finalFocus={() => branchField.current ?? true}>
            <MenuRadioGroup value={action}>
              {actions.map((candidate, index) => {
                const previous = actions[index - 1];

                return (
                  <Fragment key={candidate}>
                    {previous !== undefined &&
                      commitActionGroup(previous) !== commitActionGroup(candidate) && (
                        <MenuSeparator />
                      )}
                    <MenuRadioItem
                      value={candidate}
                      layout="plain"
                      disabled={commitActionDisabled(candidate, state)}
                      onClick={() => start(candidate)}
                    >
                      {commitActionLabel(candidate)}
                    </MenuRadioItem>
                  </Fragment>
                );
              })}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      </SplitButton.Root>
      {blocked !== undefined && !showResult && (
        <p {...props(text.sm, styles.result, styles.blocked)}>{blocked}</p>
      )}
      {pullRequest !== undefined && (
        <ChangesPullRequest pullRequest={pullRequest} onOpenLink={onOpenLink} />
      )}
      {showResult && result !== undefined && (
        <div
          role={result.tone === "error" ? "alert" : "status"}
          {...props(
            text.sm,
            result.tone === "error" && intent.danger,
            styles.result,
            result.tone === "error" && styles.resultError,
          )}
        >
          <span>{result.text.trim()}</span>
          {result.detail !== undefined && result.detail !== "" && (
            <span {...props(text.xs, styles.resultDetail)}>{result.detail}</span>
          )}
          {(result.url !== undefined || result.offerPublish === true) && (
            <span {...props(styles.resultActions)}>
              {result.url !== undefined && (
                <ButtonLink
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  variant="text"
                  onClick={(event) => {
                    event.preventDefault();

                    if (result.url !== undefined) onOpenLink(result.url);
                  }}
                >
                  {result.url}
                </ButtonLink>
              )}
              {result.offerPublish === true && (
                <Button variant="outline" loading={running} onClick={publishBranch}>
                  Publish Branch
                </Button>
              )}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
