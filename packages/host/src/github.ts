/**
 * The serving machine's GitHub CLI login and the workspace's GitHub
 * repository, read through an existing `gh` installation. Nothing runs until
 * a state is asked for. `gh auth login` runs only through `signIn`, as one
 * process that every caller shares.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import type {
  DeviceCode,
  GitHubAccount,
  GitHubProviderState,
  GitHubPullRequest,
  GitHubPullRequestContext,
  GitHubPullRequestInput,
  GitHubPullRequestOutcome,
  GitHubRepository,
} from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

const COMMAND_OUTPUT_LIMIT = 1_000_000;

const DETECTION_TIMEOUT_MS = 3_000;

const QUERY_TIMEOUT_MS = 8_000;

/** `gh pr create` writes through the API, so it outlives an ordinary query. */
const PULL_REQUEST_TIMEOUT_MS = 60_000;

/** How long `gh auth login` may take to print its one-time code. */
const SIGN_IN_CODE_TIMEOUT_MS = 30_000;

/** GitHub device codes expire after 15 minutes; the sign-in ends with them. */
const SIGN_IN_LIFETIME_MS = 15 * 60_000;

/** Sign-in output is scanned line by line; a longer line cannot hold the code. */
const SIGN_IN_LINE_LIMIT = 4_096;

const COMMAND_ENV = { GH_PROMPT_DISABLED: "1", NO_COLOR: "1", LC_ALL: "C" } as const;

export type GitHubCommandResult =
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

export interface GitHubCommandRequest {
  readonly command: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}

export type GitHubCommandRunner = (request: GitHubCommandRequest) => Promise<GitHubCommandResult>;

/** An https URL on one of `hostnames`, without credentials or a port; anything else is dropped. */
function githubUrl(value: string, hostnames: readonly string[]): string | undefined {
  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      !hostnames.includes(url.hostname)
    ) {
      return undefined;
    }

    return url.href;
  } catch {
    return undefined;
  }
}

export const runGitHubCommand: GitHubCommandRunner = (request) =>
  new Promise((resolveResult) => {
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: { ...process.env, ...COMMAND_ENV },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (result: GitHubCommandResult): void => {
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
      finish("code" in error && error.code === "ENOENT" ? { kind: "missing" } : { kind: "failed" });
    });
    child.on("close", (code) => {
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

function repositoryPart(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(value);
}

function repositoryFromParts(
  remoteName: string,
  owner: string | undefined,
  rawName: string | undefined,
): GitHubRepository | undefined {
  if (owner === undefined || rawName === undefined) return undefined;
  const name = rawName.replace(/\.git$/iu, "");

  if (!repositoryPart(owner) || !repositoryPart(name)) return undefined;

  return { owner, name, remoteName, url: `https://github.com/${owner}/${name}` };
}

/** Parse only repository identity. Userinfo and other raw remote data are discarded. */
function parseGitHubRemote(remoteName: string, rawRemote: string): GitHubRepository | undefined {
  const remote = rawRemote.trim();
  const scp = /^(?:[^@\s]+@)?github\.com:([^/\s]+)\/([^/\s]+)\/?$/iu.exec(remote);

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
  workspace: string | undefined,
  run: GitHubCommandRunner,
): Promise<GitHubRepository | undefined> {
  if (workspace === undefined) return undefined;

  const remotes = await run({
    command: "git",
    args: ["remote"],
    cwd: workspace,
    timeoutMs: DETECTION_TIMEOUT_MS,
  });

  if (remotes.kind !== "completed" || remotes.code !== 0) return undefined;

  const rank = (name: string): number => (name === "origin" ? 0 : name === "upstream" ? 1 : 2);

  const names = remotes.stdout
    .split(/\r?\n/u)
    .map((name) => name.trim())
    .filter((name) => name !== "")
    .sort((left, right) => rank(left) - rank(right));

  for (const remoteName of names) {
    const remote = await run({
      command: "git",
      args: ["remote", "get-url", remoteName],
      cwd: workspace,
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

function decodeAccount(output: string): GitHubAccount | undefined {
  try {
    const account = accountSchema.Parse(JSON.parse(output));

    return {
      login: account.login,
      name: account.name || undefined,
      avatarUrl:
        account.avatar_url === null
          ? undefined
          : githubUrl(account.avatar_url, ["avatars.githubusercontent.com"]),
    };
  } catch {
    return undefined;
  }
}

function decodePullRequest(output: string): GitHubPullRequest | undefined {
  try {
    const pull = pullRequestSchema.Parse(JSON.parse(output));
    const url = githubUrl(pull.url, ["github.com"]);

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
 * output say nothing to them, so they never reach a returned state.
 */
const RECOVERY = {
  install: "Install the GitHub CLI (gh), then try again.",
  update:
    "Update the GitHub CLI (gh) to a version that supports `gh auth status --json`, then try again.",
  signIn: "Couldn't sign in to GitHub. Run `gh auth login` in a terminal, then try again.",
  signOut: "Couldn't sign out of GitHub. Run `gh auth logout` in a terminal, then try again.",
  account: "Couldn't read your GitHub account. Try again.",
  pullRequest: "Couldn't read this branch's pull request. Try again.",
  createPullRequest: "Couldn't open a pull request. Run `gh pr create` in a terminal to see why.",
} as const;

function failure(result: GitHubCommandResult, recovery: string): string {
  return result.kind === "missing" ? RECOVERY.install : recovery;
}

async function pullRequestContext(
  workspace: string,
  repository: GitHubRepository,
  run: GitHubCommandRunner,
): Promise<GitHubPullRequestContext> {
  const branch = await run({
    command: "git",
    args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
    cwd: workspace,
    timeoutMs: DETECTION_TIMEOUT_MS,
  });

  if (branch.kind !== "completed" || branch.code !== 0 || branch.stdout.trim() === "") {
    // A detached HEAD exits 1: there is no branch to have a pull request.
    return branch.kind === "completed" && branch.code === 1
      ? { kind: "none" }
      : { kind: "error", message: RECOVERY.pullRequest };
  }

  const result = await run({
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
    cwd: workspace,
    timeoutMs: QUERY_TIMEOUT_MS,
  });

  if (result.kind === "completed" && result.code === 0) {
    const pullRequest = decodePullRequest(result.stdout);

    return pullRequest === undefined
      ? { kind: "error", message: RECOVERY.pullRequest }
      : { kind: "ready", pullRequest };
  }

  if (
    result.kind === "completed" &&
    (result.stderr.includes("no pull requests found") ||
      result.stderr.includes("Could not resolve to a PullRequest"))
  ) {
    return { kind: "none" };
  }

  return { kind: "error", message: failure(result, RECOVERY.pullRequest) };
}

async function accountState(
  workspace: string | undefined,
  run: GitHubCommandRunner,
): Promise<GitHubProviderState> {
  const repository = await detectRepository(workspace, run);

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
    return { kind: "error", repository, message: RECOVERY.account };
  }

  if (auth.code !== 0 && /unknown flag: --(?:json|jq)\b/u.test(auth.stderr)) {
    return { kind: "error", repository, message: RECOVERY.update };
  }

  // gh versions differ on the exit code when no accounts are configured.
  if ((auth.code === 0 || auth.code === 1) && auth.stdout.trim() === "") {
    return { kind: "signed_out", repository };
  }

  if (auth.code !== 0) return { kind: "error", repository, message: RECOVERY.account };

  try {
    const active = authStatusSchema.Parse(JSON.parse(auth.stdout)).find((entry) => entry.active);

    if (active === undefined) return { kind: "signed_out", repository };

    // JSON mode exits zero even for invalid credentials and network failures.
    if (active.state !== "success") {
      return {
        kind: "error",
        repository,
        message: active.state === "error" ? RECOVERY.signIn : RECOVERY.account,
      };
    }
  } catch {
    return { kind: "error", repository, message: RECOVERY.account };
  }

  const accountResult = await run({
    command: "gh",
    args: ["api", "--hostname", "github.com", "user"],
    cwd: homedir(),
    timeoutMs: QUERY_TIMEOUT_MS,
  });

  if (accountResult.kind !== "completed" || accountResult.code !== 0) {
    return { kind: "error", repository, message: failure(accountResult, RECOVERY.account) };
  }

  const account = decodeAccount(accountResult.stdout);

  if (account === undefined) return { kind: "error", repository, message: RECOVERY.account };

  const pullRequest: GitHubPullRequestContext =
    workspace === undefined || repository === undefined
      ? { kind: "none" }
      : await pullRequestContext(workspace, repository, run);

  return { kind: "ready", repository, account, pullRequest };
}

/**
 * Every precondition is read from the account state first, so a missing
 * `gh`, a signed-out account, a folder without a GitHub remote, and an
 * existing pull request are answered rather than run into.
 */
async function createPullRequest(
  workspace: string | undefined,
  input: GitHubPullRequestInput,
  run: GitHubCommandRunner,
): Promise<GitHubPullRequestOutcome> {
  if (workspace === undefined) return { kind: "no_remote" };
  const state = await accountState(workspace, run);

  if (state.kind === "cli_missing") return { kind: "cli_missing" };

  if (state.kind === "signed_out" || state.kind === "signing_in") return { kind: "signed_out" };

  if (state.kind === "error") return { kind: "failed", message: state.message };
  const { repository } = state;

  if (repository === undefined) return { kind: "no_remote" };

  if (state.pullRequest.kind === "ready") {
    return { kind: "exists", pullRequest: state.pullRequest.pullRequest };
  }

  const result = await run({
    command: "gh",
    args: [
      "pr",
      "create",
      "--repo",
      `${repository.owner}/${repository.name}`,
      "--title",
      input.title,
      "--body",
      input.body ?? "",
      ...(input.draft === true ? ["--draft"] : []),
    ],
    cwd: workspace,
    timeoutMs: PULL_REQUEST_TIMEOUT_MS,
  });

  if (result.kind === "missing") return { kind: "cli_missing" };

  if (result.kind !== "completed") return { kind: "failed", message: RECOVERY.createPullRequest };

  if (result.code !== 0) {
    // Another client can open one between the state read and this command.
    if (/already exists/iu.test(result.stderr)) {
      const current = await pullRequestContext(workspace, repository, run);

      if (current.kind === "ready") return { kind: "exists", pullRequest: current.pullRequest };
    }

    return { kind: "failed", message: RECOVERY.createPullRequest };
  }

  // `gh` prints the new pull request's URL; nothing else from its output crosses.
  const url = result.stdout
    .split(/\r?\n/u)
    .map((line) => githubUrl(line.trim(), ["github.com"]))
    .find((candidate) => candidate !== undefined);

  return url === undefined
    ? { kind: "failed", message: RECOVERY.createPullRequest }
    : { kind: "created", url };
}

type SignInEnd =
  | { readonly kind: "signed_in" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed" }
  | { readonly kind: "cancelled" };

type SignInStart =
  | { readonly kind: "code"; readonly userCode: string; readonly verificationUri: string }
  | SignInEnd;

interface SignInAttempt {
  /** Settles once the CLI prints its one-time code and verification page, or when it ends first. */
  readonly started: Promise<SignInStart>;
  readonly ended: Promise<SignInEnd>;
  readonly expiresAt: number;
  readonly cancel: () => void;
}

const USER_CODE = /one-time code\W*([A-Z0-9]{4}-[A-Z0-9]{4})\b/iu;

const PRINTED_URL = /https?:\/\/\S+/u;

function startSignIn(beforeCommand: () => Promise<void>): SignInAttempt {
  const started = Promise.withResolvers<SignInStart>();
  const ended = Promise.withResolvers<SignInEnd>();
  const expiresAt = Date.now() + SIGN_IN_LIFETIME_MS;
  let child: ChildProcess | undefined;
  let outcome: SignInEnd | undefined;
  let userCode: string | undefined;
  let verificationUri: string | undefined;

  const end = (result: SignInEnd): void => {
    if (outcome !== undefined) return;
    outcome = result;
    clearTimeout(codeTimer);
    clearTimeout(lifetime);

    if (child !== undefined) {
      child.stdout?.destroy();
      child.stderr?.destroy();

      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }

    started.resolve(result);
    ended.resolve(result);
  };

  const readLine = (line: string): void => {
    if (userCode !== undefined && verificationUri !== undefined) return;
    userCode ??= USER_CODE.exec(line)?.[1]?.toUpperCase();
    const printed = PRINTED_URL.exec(line)?.[0];

    if (verificationUri === undefined && printed !== undefined) {
      verificationUri = githubUrl(printed, ["github.com"]);

      // A page other than GitHub's is never handed to a person.
      if (verificationUri === undefined) {
        end({ kind: "failed" });

        return;
      }
    }

    if (userCode !== undefined && verificationUri !== undefined) {
      clearTimeout(codeTimer);
      started.resolve({ kind: "code", userCode, verificationUri });
    }
  };

  const scan = (stream: NodeJS.ReadableStream | null): void => {
    let pending = "";
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      if (outcome !== undefined) return;
      const lines = (pending + chunk).split(/\r?\n/u);
      pending = (lines.pop() ?? "").slice(-SIGN_IN_LINE_LIMIT);

      for (const line of lines) readLine(line);
    });
  };

  const codeTimer = setTimeout(() => end({ kind: "failed" }), SIGN_IN_CODE_TIMEOUT_MS);
  const lifetime = setTimeout(() => end({ kind: "failed" }), SIGN_IN_LIFETIME_MS);

  void beforeCommand().then(
    () => {
      if (outcome !== undefined) return;
      child = spawn(
        "gh",
        [
          "auth",
          "login",
          "--hostname",
          "github.com",
          "--web",
          "--git-protocol",
          "https",
          "--skip-ssh-key",
        ],
        {
          cwd: homedir(),
          env: { ...process.env, ...COMMAND_ENV },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      scan(child.stdout);
      scan(child.stderr);
      child.on("error", (error) => {
        end("code" in error && error.code === "ENOENT" ? { kind: "missing" } : { kind: "failed" });
      });
      child.on("close", (code) => {
        end(code === 0 ? { kind: "signed_in" } : { kind: "failed" });
      });
    },
    () => end({ kind: "failed" }),
  );

  return {
    started: started.promise,
    ended: ended.promise,
    expiresAt,
    cancel: () => end({ kind: "cancelled" }),
  };
}

export interface GitHubServiceOptions {
  /** Finishes host environment setup before `gh` or `git` can spawn. */
  readonly beforeCommand?: () => Promise<void>;
  readonly run?: GitHubCommandRunner;
}

/** GitHub for one caller. The login is machine-wide; `workspace` picks the repository. */
export interface GitHubOperations {
  /** `signing_in` while a sign-in waits for its code to be entered. */
  readonly state: (workspace?: string) => Promise<GitHubProviderState>;
  /**
   * Starts `gh auth login`, or joins the one already running, and answers
   * `signing_in` once the CLI has a one-time code. An account already signed
   * in answers `ready` and starts nothing. The sign-in ends when the code is
   * entered, after 15 minutes, on `signOut`, or on `close`.
   */
  readonly signIn: (workspace?: string) => Promise<GitHubProviderState>;
  /** Ends a sign-in still waiting for its code; otherwise removes the CLI login. */
  readonly signOut: (workspace?: string) => Promise<GitHubProviderState>;
  /** Opens one for the workspace's checked-out branch, which the caller has pushed. */
  readonly createPullRequest: (
    input: GitHubPullRequestInput,
    workspace?: string,
  ) => Promise<GitHubPullRequestOutcome>;
}

/**
 * GitHub for one serving machine. One service serves every workspace and
 * holds at most one `gh auth login` process.
 */
export interface GitHubService extends GitHubOperations {
  /**
   * The same service for one caller: a sign-in it starts ends when `owner`
   * aborts. Everything else, including a sign-in it only joined, stays shared.
   */
  readonly owned: (owner: AbortSignal) => GitHubOperations;
  /** Ends a running sign-in. `signIn` throws afterwards. */
  readonly close: () => void;
}

export function createGitHubService(options: GitHubServiceOptions = {}): GitHubService {
  const beforeCommand = options.beforeCommand ?? (() => Promise.resolve());
  const runner = options.run ?? runGitHubCommand;

  const run: GitHubCommandRunner = async (request) => {
    await beforeCommand();

    return runner(request);
  };

  let signing: SignInAttempt | undefined;
  let closed = false;

  const signingIn = async (
    attempt: SignInAttempt,
    workspace: string | undefined,
  ): Promise<GitHubProviderState> => {
    const start = await attempt.started;

    if (start.kind !== "code" || signing !== attempt) return afterSignIn(start, workspace);

    const deviceCode: DeviceCode = {
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      expiresInSeconds: Math.max(0, Math.ceil((attempt.expiresAt - Date.now()) / 1000)),
    };

    return { kind: "signing_in", repository: await detectRepository(workspace, run), deviceCode };
  };

  const afterSignIn = async (
    end: SignInStart,
    workspace: string | undefined,
  ): Promise<GitHubProviderState> => {
    switch (end.kind) {
      case "missing":
        return { kind: "cli_missing", repository: await detectRepository(workspace, run) };
      case "failed":
        return {
          kind: "error",
          repository: await detectRepository(workspace, run),
          message: RECOVERY.signIn,
        };
      case "code":
      case "signed_in":
      case "cancelled":
        return accountState(workspace, run);
      default: {
        const _exhaustive: never = end;

        return _exhaustive;
      }
    }
  };

  const cancel = (): void => {
    signing?.cancel();
    signing = undefined;
  };

  const signIn = async (
    workspace: string | undefined,
    owner: AbortSignal | undefined,
  ): Promise<GitHubProviderState> => {
    if (closed) throw new Error("The GitHub service is closed.");

    if (signing === undefined) {
      const current = await accountState(workspace, run);

      if (current.kind === "ready" || owner?.aborted === true) return current;

      if (closed) throw new Error("The GitHub service is closed.");

      // Another caller may have started one during the read; join it.
      if (signing === undefined) {
        const attempt = startSignIn(beforeCommand);
        signing = attempt;

        const release = (): void => {
          if (signing === attempt) cancel();
        };

        owner?.addEventListener("abort", release, { once: true });
        void attempt.ended.then(() => {
          owner?.removeEventListener("abort", release);

          if (signing === attempt) signing = undefined;
        });
      }
    }

    return signingIn(signing, workspace);
  };

  const operations: GitHubOperations = {
    state: (workspace) =>
      signing === undefined ? accountState(workspace, run) : signingIn(signing, workspace),
    signIn: (workspace) => signIn(workspace, undefined),
    signOut: async (workspace) => {
      // A cancelled sign-in leaves whatever login the machine already had.
      if (signing !== undefined) {
        cancel();

        return accountState(workspace, run);
      }

      const result = await run({
        command: "gh",
        args: ["auth", "logout", "--hostname", "github.com"],
        cwd: homedir(),
        timeoutMs: QUERY_TIMEOUT_MS,
      });

      if (result.kind === "missing") {
        return { kind: "cli_missing", repository: await detectRepository(workspace, run) };
      }

      const state = await accountState(workspace, run);

      if ((result.kind === "completed" && result.code === 0) || state.kind !== "ready") {
        return state;
      }

      return { kind: "error", repository: state.repository, message: RECOVERY.signOut };
    },
    createPullRequest: (input, workspace) => createPullRequest(workspace, input, run),
  };

  return {
    ...operations,
    owned: (owner) => ({ ...operations, signIn: (workspace) => signIn(workspace, owner) }),
    close: () => {
      closed = true;
      cancel();
    },
  };
}
