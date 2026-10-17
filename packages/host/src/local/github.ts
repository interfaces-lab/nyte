import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import type {
  GitHubAccount,
  GitHubCheck,
  GitHubDeviceCode,
  GitHubPullRequest,
  GitHubPullRequestContext,
  GitHubPullRequestOutcome,
  GitHubRepository,
  GitHubState,
} from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import type { ExecutionEnv, GitHubApi } from "@nyte-ai/core";
import { findExecutable, run } from "./command.ts";

const ENV = {
  GH_PROMPT_DISABLED: "1",
  GH_NO_UPDATE_NOTIFIER: "1",
  GIT_TERMINAL_PROMPT: "0",
  NO_COLOR: "1",
  LC_ALL: "C",
};

const OUTPUT_LIMIT = 1_000_000;

const QUERY_TIMEOUT_MS = 10_000;

/** `gh pr create` writes through the API, so it outlives a read. */
const CREATE_TIMEOUT_MS = 60_000;

/** How long `gh auth login` may take to print its one-time code. */
const SIGN_IN_CODE_TIMEOUT_MS = 30_000;

/** GitHub device codes expire after 15 minutes; the sign-in ends with them. */
const SIGN_IN_LIFETIME_MS = 15 * 60_000;

const NO_PULL_REQUEST: GitHubPullRequestContext = { kind: "none" };

const PULL_REQUEST_FIELDS =
  "number,title,url,state,isDraft,headRefName,baseRefName,statusCheckRollup";

/** gh orders remotes this way to choose a base repository; the state names the one it would use. */
const REMOTE_PRIORITY = ["upstream", "github", "origin"];

/** What the person reading the message can do next. `gh`'s own output never reaches a state. */
const RECOVERY = {
  update: "Update the GitHub CLI (gh), then try again.",
  signIn: "GitHub rejected the CLI's login. Run gh auth login in a terminal, then try again.",
  signOut: "Couldn't sign out of GitHub. Run gh auth logout in a terminal, then try again.",
  account: "Couldn't reach GitHub. Try again.",
  pullRequest: "Couldn't read this branch's pull request. Try again.",
  createPullRequest: "Couldn't open a pull request. Run gh pr create in a terminal to see why.",
} as const;

type Command =
  | { readonly kind: "missing" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "completed";
      readonly code: number;
      readonly stdout: string;
      readonly stderr: string;
    };

type Auth =
  | { readonly kind: "missing" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly login: string };

const authSchema = Compile(
  Type.Array(Type.Object({ active: Type.Boolean(), state: Type.String(), login: Type.String() })),
);

const accountSchema = Compile(
  Type.Object({
    login: Type.String({ minLength: 1 }),
    name: Type.Union([Type.String(), Type.Null()]),
    avatar_url: Type.Union([Type.String(), Type.Null()]),
  }),
);

const optionalText = Type.Optional(Type.Union([Type.String(), Type.Null()]));

const PullRequestJson = Type.Object({
  number: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  title: Type.String(),
  url: Type.String(),
  state: Type.Enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: Type.Boolean(),
  headRefName: Type.String({ minLength: 1 }),
  baseRefName: Type.String({ minLength: 1 }),
  statusCheckRollup: Type.Union([
    Type.Null(),
    Type.Array(
      Type.Object({
        __typename: Type.String(),
        name: optionalText,
        context: optionalText,
        status: optionalText,
        conclusion: optionalText,
        state: optionalText,
        detailsUrl: optionalText,
        targetUrl: optionalText,
      }),
    ),
  ]),
});

const pullRequestSchema = Compile(PullRequestJson);

type RollupEntry = NonNullable<Static<typeof PullRequestJson>["statusCheckRollup"]>[number];

function parseJson<T>(validator: { Parse(value: unknown): T }, text: string): T | undefined {
  try {
    return validator.Parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** An https URL on one of `hostnames` (any host when absent), without credentials or a port; anything else is dropped. */
function safeUrl(
  value: string | null | undefined,
  hostnames?: readonly string[],
): string | undefined {
  const url = URL.parse(value ?? "");

  if (
    url === null ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    (hostnames !== undefined && !hostnames.includes(url.hostname))
  )
    return undefined;

  return url.href;
}

const REPOSITORY_PART = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;

/** Only the repository's identity is read from a remote URL: userinfo and the raw URL are discarded. */
function parseRemote(remoteName: string, remote: string): GitHubRepository | undefined {
  const scp = /^(?:[^@\s]+@)?github\.com:([^/\s]+)\/([^/\s]+?)\/?$/iu.exec(remote);
  const url = scp === null ? URL.parse(remote) : null;

  const parts =
    scp === null
      ? url !== null && url.hostname.toLowerCase() === "github.com"
        ? url.pathname.split("/").filter((segment) => segment !== "")
        : []
      : [scp[1] ?? "", scp[2] ?? ""];

  if (parts.length !== 2) return undefined;
  const owner = parts[0] ?? "";
  const name = (parts[1] ?? "").replace(/\.git$/iu, "");

  if (!REPOSITORY_PART.test(owner) || !REPOSITORY_PART.test(name)) return undefined;

  return { owner, name, remoteName, url: `https://github.com/${owner}/${name}` };
}

/** Folds a check run's status and conclusion, or a commit status's state, to the state a reader acts on. */
function checkState(entry: RollupEntry): GitHubCheck["state"] {
  if (entry.__typename === "StatusContext") {
    if (entry.state === "SUCCESS") return "passed";

    return entry.state === "ERROR" || entry.state === "FAILURE" ? "failed" : "pending";
  }

  if (entry.status !== "COMPLETED") return "pending";

  switch (entry.conclusion) {
    case "SUCCESS":
    case "NEUTRAL":
      return "passed";
    case "SKIPPED":
    case "STALE":
      return "skipped";
    default:
      return "failed";
  }
}

function readCheck(entry: RollupEntry): GitHubCheck {
  const url = safeUrl(entry.detailsUrl ?? entry.targetUrl);
  const check = { name: entry.name ?? entry.context ?? "Check", state: checkState(entry) };

  return url === undefined ? check : { ...check, url };
}

function readPullRequestJson(text: string): GitHubPullRequest | undefined {
  const pull = parseJson(pullRequestSchema, text);
  const url = safeUrl(pull?.url, ["github.com"]);

  if (pull === undefined || url === undefined) return undefined;

  return {
    number: pull.number,
    title: pull.title,
    url,
    state: pull.state,
    draft: pull.isDraft,
    headRefName: pull.headRefName,
    baseRefName: pull.baseRefName,
    checks: (pull.statusCheckRollup ?? []).map(readCheck),
  };
}

function readAccountJson(text: string): GitHubAccount | undefined {
  const account = parseJson(accountSchema, text);

  if (account === undefined) return undefined;
  const avatarUrl = safeUrl(account.avatar_url, ["avatars.githubusercontent.com"]);

  return {
    login: account.login,
    ...(account.name === null || account.name === "" ? {} : { name: account.name }),
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
  };
}

const USER_CODE = /one-time code\W*([A-Z0-9]{4}-[A-Z0-9]{4})\b/iu;

const PRINTED_URL = /https:\/\/\S+/u;

/** Sign-in output is scanned line by line; a longer line cannot hold the code. */
const SIGN_IN_LINE_LIMIT = 4_096;

type SignInStart =
  | { readonly kind: "code"; readonly deviceCode: GitHubDeviceCode }
  | { readonly kind: "ended" }
  | { readonly kind: "failed" };

interface SignIn {
  /** Settles once `gh` printed its code and page, or when it ended before. */
  readonly started: Promise<SignInStart>;
  readonly expiresAt: number;
  cancel(): void;
}

/** Runs `gh auth login --web` on github.com, reading the one-time code and the page it prints; `ended` runs once the process is gone. */
function startSignIn(file: string, cwd: string, ended: () => void): SignIn {
  const started = Promise.withResolvers<SignInStart>();
  const expiresAt = Date.now() + SIGN_IN_LIFETIME_MS;
  let userCode: string | undefined;
  let verificationUri: string | undefined;
  let done = false;

  const child: ChildProcess = spawn(
    file,
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
    { cwd, env: { ...process.env, ...ENV }, stdio: ["ignore", "pipe", "pipe"] },
  );

  const end = (start: SignInStart): void => {
    if (done) return;
    done = true;
    clearTimeout(codeTimer);
    clearTimeout(lifetime);
    child.stdout?.destroy();
    child.stderr?.destroy();

    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    started.resolve(start);
    ended();
  };

  const readLine = (line: string): void => {
    userCode ??= USER_CODE.exec(line)?.[1]?.toUpperCase();
    const printed = PRINTED_URL.exec(line)?.[0];

    if (verificationUri === undefined && printed !== undefined) {
      verificationUri = safeUrl(printed, ["github.com"]);

      if (verificationUri === undefined) end({ kind: "failed" });
    }

    if (userCode === undefined || verificationUri === undefined) return;
    clearTimeout(codeTimer);
    started.resolve({ kind: "code", deviceCode: { userCode, verificationUri } });
  };

  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      const lines = (pending + chunk).split(/\r?\n/u);
      pending = (lines.pop() ?? "").slice(-SIGN_IN_LINE_LIMIT);

      for (const line of lines) if (!done) readLine(line);
    });
  }

  child.on("error", () => end({ kind: "failed" }));
  child.on("close", (code) => end(code === 0 ? { kind: "ended" } : { kind: "failed" }));
  const codeTimer = setTimeout(() => end({ kind: "failed" }), SIGN_IN_CODE_TIMEOUT_MS);
  const lifetime = setTimeout(() => end({ kind: "failed" }), SIGN_IN_LIFETIME_MS);

  return { started: started.promise, expiresAt, cancel: () => end({ kind: "ended" }) };
}

/**
 * Returns GitHub for each local workspace through the machine's `gh` (`gh`,
 * default `gh` on the PATH) and `git`. Nothing runs until a state is asked
 * for. The login is machine-wide: every workspace shares at most one
 * `gh auth login`. `state` reads the github.com account (`gh auth status`,
 * then `gh api user`), the repository from the remotes in gh's base-repository
 * order (`upstream`, `github`, `origin`, then the rest; only github.com
 * remotes), and the checked-out branch's pull request with its check rollup
 * (`gh pr view <branch> --json`, the branch as `<owner>:<branch>` when it
 * tracks a fork). While a sign-in runs, `state` answers its code until it
 * ends, then what the login became. `createPullRequest` answers each precondition from that
 * state, an open pull request as `exists`, and otherwise runs
 * `gh pr create --head <branch>` with the title, the body on stdin, and
 * `--fill` for whichever of the two is missing.
 */
export function localGitHub(options?: {
  readonly gh?: string;
  readonly git?: string;
}): (env: ExecutionEnv) => GitHubApi {
  const binary = options?.gh ?? "gh";
  const gitBinary = options?.git ?? "git";
  let signing: SignIn | undefined;

  const gh = async (
    cwd: string,
    args: readonly string[],
    extra?: { readonly input?: string; readonly timeoutMs?: number },
  ): Promise<Command> => {
    const file = await findExecutable(binary);

    if (file === null) return { kind: "missing" };
    const started = Date.now();

    const ran = await run(file, args, {
      cwd,
      env: ENV,
      input: extra?.input,
      limit: OUTPUT_LIMIT,
      timeoutMs: extra?.timeoutMs ?? QUERY_TIMEOUT_MS,
    }).catch(() => null);

    dev("github", "run", {
      command: args.slice(0, 2).join(" "),
      code: ran?.code ?? null,
      ms: Date.now() - started,
    });

    if (ran === null || ran.code === null || ran.truncated) return { kind: "failed" };

    return {
      kind: "completed",
      code: ran.code,
      stdout: ran.stdout.toString("utf8"),
      stderr: ran.stderr,
    };
  };

  const git = async (cwd: string, args: readonly string[]): Promise<string | null> => {
    const ran = await run(gitBinary, args, {
      cwd,
      env: ENV,
      timeoutMs: QUERY_TIMEOUT_MS,
    }).catch(() => null);

    return ran?.code === 0 ? ran.stdout.toString("utf8").trim() : null;
  };

  const remotes = async (cwd: string): Promise<readonly GitHubRepository[]> => {
    const listed = (await git(cwd, ["remote", "-v"])) ?? "";
    const found = new Map<string, GitHubRepository>();

    for (const line of listed.split("\n")) {
      const [name = "", url = ""] = line.split(/\s+/u);
      const repository = found.has(name) ? undefined : parseRemote(name, url);

      if (repository !== undefined) found.set(name, repository);
    }

    const rank = (name: string): number => {
      const position = REMOTE_PRIORITY.findIndex((candidate) => candidate === name);

      return position < 0 ? REMOTE_PRIORITY.length : position;
    };

    return [...found.values()].sort(
      (left, right) => rank(left.remoteName) - rank(right.remoteName),
    );
  };

  const readAuth = async (cwd: string): Promise<Auth> => {
    const result = await gh(cwd, [
      "auth",
      "status",
      "--hostname",
      "github.com",
      "--json",
      "hosts",
      "--jq",
      '[(.hosts["github.com"] // [])[] | {active, state, login}]',
    ]);

    if (result.kind === "missing") return result;

    if (result.kind === "failed") return { kind: "error", message: RECOVERY.account };

    if (result.code !== 0)
      return {
        kind: "error",
        message: /unknown flag: --(?:json|jq)\b/u.test(result.stderr)
          ? RECOVERY.update
          : RECOVERY.account,
      };

    const entries = parseJson(authSchema, result.stdout);

    if (entries === undefined) return { kind: "error", message: RECOVERY.update };
    const active = entries.find((entry) => entry.active);

    if (active === undefined) return { kind: "signed_out" };

    if (active.state !== "success")
      return {
        kind: "error",
        message: active.state === "error" ? RECOVERY.signIn : RECOVERY.account,
      };

    return { kind: "ready", login: active.login };
  };

  const readAccount = async (cwd: string): Promise<GitHubAccount | undefined> => {
    const result = await gh(cwd, ["api", "--hostname", "github.com", "user"]);

    return result.kind === "completed" && result.code === 0
      ? readAccountJson(result.stdout)
      : undefined;
  };

  const readHead = async (
    cwd: string,
    repository: GitHubRepository,
    found: readonly GitHubRepository[],
  ): Promise<string | undefined> => {
    const branch = await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);

    if (branch === null || branch === "") return undefined;
    const tracked = await git(cwd, ["config", "--get", `branch.${branch}.remote`]);
    const owner = found.find((candidate) => candidate.remoteName === tracked)?.owner;

    return owner === undefined || owner === repository.owner ? branch : `${owner}:${branch}`;
  };

  const readPullRequest = async (
    cwd: string,
    repository: GitHubRepository,
    head: string | undefined,
  ): Promise<GitHubPullRequestContext> => {
    if (head === undefined) return { kind: "none" };

    const result = await gh(cwd, [
      "pr",
      "view",
      head,
      "--repo",
      `${repository.owner}/${repository.name}`,
      "--json",
      PULL_REQUEST_FIELDS,
    ]);

    if (result.kind === "completed" && result.code === 0) {
      const pullRequest = readPullRequestJson(result.stdout);

      return pullRequest === undefined
        ? { kind: "error", message: RECOVERY.pullRequest }
        : { kind: "ready", pullRequest };
    }

    if (result.kind === "completed" && /no (?:open )?pull requests? found/iu.test(result.stderr))
      return { kind: "none" };

    return { kind: "error", message: RECOVERY.pullRequest };
  };

  const readState = async (
    cwd: string,
  ): Promise<{
    readonly state: GitHubState;
    readonly head: string | undefined;
  }> => {
    const [found, auth] = await Promise.all([remotes(cwd), readAuth(cwd)]);
    const repository = found[0];
    const located = repository === undefined ? {} : { repository };

    if (auth.kind === "missing")
      return { state: { kind: "cli_missing", ...located }, head: undefined };

    if (auth.kind === "signed_out")
      return { state: { kind: "signed_out", ...located }, head: undefined };

    if (auth.kind === "error")
      return { state: { kind: "error", ...located, message: auth.message }, head: undefined };

    const branch = async () => {
      if (repository === undefined) return { head: undefined, pullRequest: NO_PULL_REQUEST };
      const head = await readHead(cwd, repository, found);

      return { head, pullRequest: await readPullRequest(cwd, repository, head) };
    };

    const [account, { head, pullRequest }] = await Promise.all([readAccount(cwd), branch()]);

    if (account === undefined)
      return { state: { kind: "error", ...located, message: RECOVERY.account }, head };

    return { state: { kind: "ready", ...located, account, pullRequest }, head };
  };

  const signingState = async (cwd: string, attempt: SignIn): Promise<GitHubState> => {
    const start = await attempt.started;

    if (start.kind !== "code") {
      const { state } = await readState(cwd);

      return start.kind === "failed" && state.kind === "signed_out"
        ? { ...state, kind: "error", message: RECOVERY.signIn }
        : state;
    }

    const found = await remotes(cwd);
    const repository = found[0];

    return {
      kind: "signing_in",
      ...(repository === undefined ? {} : { repository }),
      deviceCode: {
        ...start.deviceCode,
        expiresInSeconds: Math.max(0, Math.ceil((attempt.expiresAt - Date.now()) / 1000)),
      },
    };
  };

  const signIn = async (cwd: string): Promise<GitHubState> => {
    if (signing !== undefined) return signingState(cwd, signing);
    const { state } = await readState(cwd);

    if (state.kind !== "signed_out" && state.kind !== "error") return state;

    if (signing !== undefined) return signingState(cwd, signing);
    const file = await findExecutable(binary);

    if (file === null) return { ...state, kind: "cli_missing" };

    const attempt = startSignIn(file, cwd, () => {
      if (signing === attempt) signing = undefined;
    });

    signing = attempt;

    return signingState(cwd, attempt);
  };

  const signOut = async (cwd: string): Promise<GitHubState> => {
    if (signing !== undefined) {
      signing.cancel();
      signing = undefined;

      return (await readState(cwd)).state;
    }

    const auth = await readAuth(cwd);

    if (auth.kind !== "ready") return (await readState(cwd)).state;

    const result = await gh(cwd, [
      "auth",
      "logout",
      "--hostname",
      "github.com",
      "--user",
      auth.login,
    ]);

    const { state } = await readState(cwd);

    if ((result.kind === "completed" && result.code === 0) || state.kind !== "ready") return state;

    return { ...state, kind: "error", message: RECOVERY.signOut };
  };

  const createPullRequest = async (
    cwd: string,
    input: { readonly title?: string; readonly body?: string; readonly draft?: boolean },
  ): Promise<GitHubPullRequestOutcome> => {
    const { state, head } = await readState(cwd);

    switch (state.kind) {
      case "cli_missing":
        return { kind: "cli_missing" };
      case "signed_out":
      case "signing_in":
        return { kind: "signed_out" };
      case "error":
        return { kind: "failed", message: state.message };
      case "ready":
        break;
    }

    const { repository, pullRequest } = state;

    if (repository === undefined) return { kind: "no_remote" };

    if (head === undefined) return { kind: "detached" };

    if (pullRequest.kind === "ready" && pullRequest.pullRequest.state === "OPEN")
      return { kind: "exists", pullRequest: pullRequest.pullRequest };

    const title = input.title?.trim() ?? "";
    const body = input.body ?? "";

    const result = await gh(
      cwd,
      [
        "pr",
        "create",
        "--repo",
        `${repository.owner}/${repository.name}`,
        "--head",
        head,
        ...(title === "" ? [] : ["--title", title]),
        ...(title === "" || body === "" ? ["--fill"] : ["--body-file", "-"]),
        ...(input.draft === true ? ["--draft"] : []),
      ],
      { input: title === "" ? "" : body, timeoutMs: CREATE_TIMEOUT_MS },
    );

    if (result.kind === "missing") return { kind: "cli_missing" };

    if (result.kind === "completed" && result.code === 0) {
      const url = result.stdout
        .split(/\r?\n/u)
        .map((line) => safeUrl(line.trim(), ["github.com"]))
        .find((candidate) => candidate !== undefined);

      if (url !== undefined) return { kind: "created", url };
    }

    if (result.kind === "completed" && /already exists/iu.test(result.stderr)) {
      const current = await readPullRequest(cwd, repository, head);

      if (current.kind === "ready") return { kind: "exists", pullRequest: current.pullRequest };
    }

    return { kind: "failed", message: RECOVERY.createPullRequest };
  };

  return (env) => ({
    state: async () =>
      signing === undefined ? (await readState(env.cwd)).state : signingState(env.cwd, signing),
    signIn: () => signIn(env.cwd),
    signOut: () => signOut(env.cwd),
    createPullRequest: (input) => createPullRequest(env.cwd, input),
  });
}
