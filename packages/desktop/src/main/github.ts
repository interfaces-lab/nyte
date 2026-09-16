/**
 * Optional GitHub enrichment over an existing `gh` installation. The module
 * starts no work until the renderer asks for provider state, and `gh auth
 * login` runs only through the explicit sign-in operation.
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type {
  DesktopVcsPullRequestInput,
  DesktopVcsPullRequestResult,
  GitHubAccount,
  GitHubProviderState,
  GitHubPullRequest,
  GitHubPullRequestContext,
  GitHubRepository,
} from "../shared/ipc.ts";
import { errorCode } from "./errors.ts";
import { ensureShellEnvironment } from "./shell-environment.ts";

const COMMAND_OUTPUT_LIMIT = 1_000_000;
const DETECTION_TIMEOUT_MS = 3_000;
const QUERY_TIMEOUT_MS = 8_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** `gh pr create` publishes the branch first, so it outlives an ordinary query. */
const PULL_REQUEST_TIMEOUT_MS = 60_000;

export type CommandResult =
  | {
      readonly kind: "completed";
      readonly code: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "timeout" }
  | { readonly kind: "output_limit" }
  | { readonly kind: "failed" };

export interface CommandRequest {
  readonly command: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

function httpsUrl(value: string, hostname?: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || (hostname !== undefined && url.hostname !== hostname)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export const runProviderCommand: CommandRunner = async (request) => {
  await ensureShellEnvironment();
  return new Promise((resolveResult) => {
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1",
        NO_COLOR: "1",
        LC_ALL: "C",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.length = 0;
      stderr.length = 0;
      child.stdout.destroy();
      child.stderr.destroy();
      if (result.kind !== "completed") {
        child.kill("SIGKILL");
        child.unref();
      }
      resolveResult(result);
    };
    const collect = (target: Buffer[], chunk: Buffer): void => {
      if (settled) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > COMMAND_OUTPUT_LIMIT) {
        finish({ kind: "output_limit" });
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", (error) => {
      finish(errorCode(error) === "ENOENT" ? { kind: "missing" } : { kind: "failed" });
    });
    child.on("close", (code) => {
      if (settled) return;
      finish({
        kind: "completed",
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    const timer = setTimeout(() => {
      finish({ kind: "timeout" });
    }, request.timeoutMs);
  });
};

function repositoryPart(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value);
}

function repositoryFromParts(
  remoteName: string,
  owner: string | undefined,
  rawName: string | undefined,
): GitHubRepository | undefined {
  if (owner === undefined || rawName === undefined) return undefined;
  const name = rawName.replace(/\.git$/i, "");
  if (!repositoryPart(owner) || !repositoryPart(name)) return undefined;
  return {
    owner,
    name,
    remoteName,
    url: `https://github.com/${owner}/${name}`,
  };
}

/** Parse only repository identity. Userinfo and other raw remote data are discarded. */
function parseGitHubRemote(remoteName: string, rawRemote: string): GitHubRepository | undefined {
  const remote = rawRemote.trim();
  const scp = /^(?:[^@\s]+@)?github\.com:([^/\s]+)\/([^/\s]+)\/?$/i.exec(remote);
  if (scp !== null) return repositoryFromParts(remoteName, scp[1], scp[2]);

  let url: URL;
  try {
    url = new URL(remote);
  } catch {
    return undefined;
  }
  if (url.hostname.toLowerCase() !== "github.com") return undefined;
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  if (segments.length !== 2) return undefined;
  return repositoryFromParts(remoteName, segments[0], segments[1]);
}

async function detectRepository(
  cwd: string,
  run: CommandRunner,
): Promise<GitHubRepository | undefined> {
  const remotes = await run({
    command: "git",
    args: ["remote"],
    cwd,
    timeoutMs: DETECTION_TIMEOUT_MS,
  });
  if (remotes.kind !== "completed" || remotes.code !== 0) return undefined;
  const names = remotes.stdout
    .split(/\r?\n/u)
    .map((name) => name.trim())
    .filter((name) => name !== "")
    .sort((left, right) => {
      const rank = (name: string): number => (name === "origin" ? 0 : name === "upstream" ? 1 : 2);
      return rank(left) - rank(right);
    });
  for (const remoteName of names) {
    const remote = await run({
      command: "git",
      args: ["remote", "get-url", remoteName],
      cwd,
      timeoutMs: DETECTION_TIMEOUT_MS,
    });
    if (remote.kind !== "completed" || remote.code !== 0) continue;
    const repository = parseGitHubRemote(remoteName, remote.stdout);
    if (repository !== undefined) return repository;
  }
  return undefined;
}

const authStatusSchema = Compile(
  Type.Array(
    Type.Object({
      active: Type.Boolean(),
      state: Type.Enum(["success", "error", "timeout"]),
    }),
  ),
);
const accountSchema = Compile(
  Type.Object({
    login: Type.String({ minLength: 1 }),
    name: Type.Union([Type.String(), Type.Null()]),
    avatar_url: Type.Union([Type.String(), Type.Null()]),
  }),
);
const pullRequestSchema = Compile(
  Type.Object({
    number: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    title: Type.String({ minLength: 1 }),
    url: Type.String(),
    state: Type.Enum(["OPEN", "CLOSED", "MERGED"]),
    isDraft: Type.Boolean(),
    headRefName: Type.String({ minLength: 1 }),
    baseRefName: Type.String({ minLength: 1 }),
  }),
);

export function decodeGitHubAccountOutput(output: string): GitHubAccount | undefined {
  try {
    const account = accountSchema.Parse(JSON.parse(output));
    const avatarUrl = account.avatar_url ? httpsUrl(account.avatar_url) : undefined;
    if (account.avatar_url && avatarUrl === undefined) return undefined;
    return { login: account.login, name: account.name || undefined, avatarUrl };
  } catch {
    return undefined;
  }
}

export function decodeGitHubPullRequestOutput(output: string): GitHubPullRequest | undefined {
  try {
    const pull = pullRequestSchema.Parse(JSON.parse(output));
    const url = httpsUrl(pull.url, "github.com");
    if (url === undefined) return undefined;
    return {
      number: pull.number,
      title: pull.title,
      url,
      state: pull.state,
      draft: pull.isDraft,
      headRefName: pull.headRefName,
      baseRefName: pull.baseRefName,
    };
  } catch {
    return undefined;
  }
}

/**
 * What the person reading the message can do next. The `gh` exit code and
 * stderr say nothing to them, so they never reach the renderer.
 */
type GitHubAction = "sign-in" | "sign-out" | "account" | "pull-request" | "create-pull-request";

const ACTION_RECOVERY: Readonly<Record<GitHubAction, string>> = {
  "sign-in": "Couldn't sign in to GitHub. Run `gh auth login` in a terminal, then try again.",
  "sign-out": "Couldn't sign out of GitHub. Run `gh auth logout` in a terminal, then try again.",
  account: "Couldn't read your GitHub account. Try again.",
  "pull-request": "Couldn't read this branch's pull request. Try again.",
  "create-pull-request":
    "Couldn't open a pull request. Run `gh pr create` in a terminal to see why.",
};

function commandFailed(result: CommandResult, action: GitHubAction): string {
  return result.kind === "missing"
    ? "Install the GitHub CLI (gh), then try again."
    : ACTION_RECOVERY[action];
}

async function accountState(
  cwd: string,
  repository: GitHubRepository | undefined,
  run: CommandRunner,
): Promise<GitHubProviderState> {
  const auth = await run({
    command: "gh",
    args: [
      "auth",
      "status",
      "--hostname",
      "github.com",
      "--json",
      "hosts",
      "--jq",
      '[.hosts["github.com"][] | {active, state}]',
    ],
    cwd: homedir(),
    timeoutMs: DETECTION_TIMEOUT_MS,
  });
  if (auth.kind === "missing") return { kind: "cli_missing", repository };
  if (auth.kind !== "completed") {
    return { kind: "error", repository, message: commandFailed(auth, "account") };
  }
  if (auth.code !== 0 && /unknown flag: --(?:json|jq)\b/u.test(auth.stderr)) {
    return {
      kind: "error",
      repository,
      message:
        "Update the GitHub CLI (gh) to a version that supports `gh auth status --json`, then try again.",
    };
  }
  // gh versions differ on the exit code when no accounts are configured.
  if ((auth.code === 0 || auth.code === 1) && auth.stdout.trim() === "") {
    return { kind: "signed_out", repository };
  }
  if (auth.code !== 0) {
    return { kind: "error", repository, message: ACTION_RECOVERY.account };
  }
  try {
    const active = authStatusSchema.Parse(JSON.parse(auth.stdout)).find((entry) => entry.active);
    if (active === undefined) return { kind: "signed_out", repository };
    // JSON mode exits zero even for invalid credentials and network failures.
    if (active.state !== "success") {
      return {
        kind: "error",
        repository,
        message: active.state === "error" ? ACTION_RECOVERY["sign-in"] : ACTION_RECOVERY.account,
      };
    }
  } catch {
    return { kind: "error", repository, message: ACTION_RECOVERY.account };
  }

  const accountResult = await run({
    command: "gh",
    args: ["api", "--hostname", "github.com", "user"],
    cwd: homedir(),
    timeoutMs: QUERY_TIMEOUT_MS,
  });
  if (accountResult.kind !== "completed" || accountResult.code !== 0) {
    return {
      kind: "error",
      repository,
      message: commandFailed(accountResult, "account"),
    };
  }
  const account = decodeGitHubAccountOutput(accountResult.stdout);
  if (account === undefined) {
    return { kind: "error", repository, message: ACTION_RECOVERY.account };
  }

  if (repository === undefined) {
    return { kind: "ready", repository, account, pullRequest: { kind: "none" } };
  }
  const branch = await run({
    command: "git",
    args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
    cwd,
    timeoutMs: DETECTION_TIMEOUT_MS,
  });
  if (branch.kind !== "completed" || branch.code !== 0 || branch.stdout.trim() === "") {
    const pullRequest: GitHubPullRequestContext =
      branch.kind === "completed" && branch.code === 1
        ? { kind: "none" }
        : { kind: "error", message: ACTION_RECOVERY["pull-request"] };
    return { kind: "ready", repository, account, pullRequest };
  }
  const pullResult = await run({
    command: "gh",
    args: [
      "pr",
      "view",
      branch.stdout.trim(),
      "--repo",
      `${repository.owner}/${repository.name}`,
      "--json",
      "number,title,url,state,isDraft,headRefName,baseRefName",
    ],
    cwd,
    timeoutMs: QUERY_TIMEOUT_MS,
  });
  let pullRequest: GitHubPullRequestContext;
  if (pullResult.kind === "completed" && pullResult.code === 0) {
    const parsed = decodeGitHubPullRequestOutput(pullResult.stdout);
    pullRequest =
      parsed === undefined
        ? { kind: "error", message: ACTION_RECOVERY["pull-request"] }
        : { kind: "ready", pullRequest: parsed };
  } else if (
    pullResult.kind === "completed" &&
    (pullResult.stderr.includes("no pull requests found") ||
      pullResult.stderr.includes("Could not resolve to a PullRequest"))
  ) {
    pullRequest = { kind: "none" };
  } else {
    pullRequest = {
      kind: "error",
      message: commandFailed(pullResult, "pull-request"),
    };
  }
  return { kind: "ready", repository, account, pullRequest };
}

export interface GitHubProvider {
  readonly state: () => Promise<GitHubProviderState>;
  readonly signIn: () => Promise<GitHubProviderState>;
  readonly signOut: () => Promise<GitHubProviderState>;
  /**
   * Open a pull request for the checked-out branch. Every precondition is read
   * from the provider state first, so a missing `gh`, a signed-out account, a
   * repository without a GitHub remote, and an existing pull request are
   * answered rather than run into.
   */
  readonly createPullRequest: (
    input: DesktopVcsPullRequestInput,
  ) => Promise<DesktopVcsPullRequestResult>;
}

/** The state a pull request request can be refused from, before `gh pr create` runs. */
function refusal(state: GitHubProviderState): DesktopVcsPullRequestResult | undefined {
  if (state.kind === "cli_missing") return { kind: "cli_missing" };
  if (state.kind === "signed_out") return { kind: "signed_out" };
  if (state.kind === "error") return { kind: "failed", message: state.message };
  if (state.repository === undefined) return { kind: "no_remote" };
  if (state.pullRequest.kind === "ready") {
    return { kind: "exists", pullRequest: state.pullRequest.pullRequest };
  }
  return undefined;
}

async function createPullRequest(
  cwd: string,
  state: GitHubProviderState,
  input: DesktopVcsPullRequestInput,
  run: CommandRunner,
): Promise<DesktopVcsPullRequestResult> {
  const refused = refusal(state);
  if (refused !== undefined) return refused;
  if (state.kind !== "ready" || state.repository === undefined) {
    return { kind: "failed", message: ACTION_RECOVERY["create-pull-request"] };
  }
  const result = await run({
    command: "gh",
    args: [
      "pr",
      "create",
      "--repo",
      `${state.repository.owner}/${state.repository.name}`,
      "--title",
      input.title,
      "--body",
      input.body ?? "",
      ...(input.draft === true ? ["--draft"] : []),
    ],
    cwd,
    timeoutMs: PULL_REQUEST_TIMEOUT_MS,
  });
  if (result.kind === "missing") return { kind: "cli_missing" };
  if (result.kind !== "completed") {
    return { kind: "failed", message: commandFailed(result, "create-pull-request") };
  }
  if (result.code !== 0) {
    // Another client can open one between the state read and this command.
    if (/already exists/iu.test(result.stderr)) {
      const current = await accountState(cwd, state.repository, run);
      if (current.kind === "ready" && current.pullRequest.kind === "ready") {
        return { kind: "exists", pullRequest: current.pullRequest.pullRequest };
      }
    }
    return { kind: "failed", message: ACTION_RECOVERY["create-pull-request"] };
  }
  // `gh` prints the new pull request's URL; nothing else from its output crosses IPC.
  const url = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .map((line) => httpsUrl(line, "github.com"))
    .find((candidate) => candidate !== undefined);
  return url === undefined
    ? { kind: "failed", message: ACTION_RECOVERY["create-pull-request"] }
    : { kind: "created", url };
}

export function createGitHubProvider(
  workspace: string | undefined,
  run: CommandRunner = runProviderCommand,
): GitHubProvider {
  const cwd = workspace ?? homedir();
  const repository = () =>
    workspace === undefined ? Promise.resolve(undefined) : detectRepository(cwd, run);
  const state = async (): Promise<GitHubProviderState> =>
    accountState(cwd, await repository(), run);

  const changeAuth = async (action: "sign-in" | "sign-out"): Promise<GitHubProviderState> => {
    const result = await run({
      command: "gh",
      args:
        action === "sign-in"
          ? [
              "auth",
              "login",
              "--hostname",
              "github.com",
              "--web",
              "--clipboard",
              "--git-protocol",
              "https",
              "--skip-ssh-key",
            ]
          : ["auth", "logout", "--hostname", "github.com"],
      cwd: homedir(),
      timeoutMs: action === "sign-in" ? SIGN_IN_TIMEOUT_MS : QUERY_TIMEOUT_MS,
    });
    if (result.kind === "completed" && result.code === 0) return state();
    const detected = await repository();
    return result.kind === "missing"
      ? { kind: "cli_missing", repository: detected }
      : { kind: "error", repository: detected, message: commandFailed(result, action) };
  };
  return {
    state,
    signIn: () => changeAuth("sign-in"),
    signOut: () => changeAuth("sign-out"),
    createPullRequest: async (input) => {
      if (workspace === undefined) return { kind: "no_remote" };
      return createPullRequest(cwd, await state(), input, run);
    },
  };
}
