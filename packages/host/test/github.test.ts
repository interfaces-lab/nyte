import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubService } from "../src/github.ts";
import type {
  GitHubCommandRequest,
  GitHubCommandResult,
  GitHubCommandRunner,
  GitHubService,
} from "../src/github.ts";

const authenticated = JSON.stringify([{ active: true, state: "success" }]);
const account = {
  login: "octocat",
  name: "The Octocat",
  avatar_url: "https://avatars.githubusercontent.com/u/583231",
};
const pull = {
  number: 12,
  title: "Fix escaping",
  url: "https://github.com/owner/repo/pull/12",
  state: "OPEN",
  isDraft: false,
  headRefName: "feature",
  baseRefName: "main",
};

const completed = (stdout = "", code = 0, stderr = ""): GitHubCommandResult => ({
  kind: "completed",
  code,
  stdout,
  stderr,
});

interface Machine {
  readonly signedIn?: () => boolean;
  readonly remote?: string;
  readonly account?: object;
  readonly pull?: object;
  readonly calls?: GitHubCommandRequest[];
}

function machine(options: Machine = {}): GitHubCommandRunner {
  return async (request) => {
    options.calls?.push(request);
    const [first, second] = request.args;
    if (request.command === "git") {
      if (options.remote === undefined) return completed("", 128);
      if (first === "symbolic-ref") return completed("feature\n");
      return completed(request.args.length === 1 ? "origin\n" : `${options.remote}\n`);
    }
    if (first === "api") return completed(JSON.stringify(options.account ?? account));
    if (first === "pr") return completed(JSON.stringify(options.pull ?? pull));
    if (second === "status") {
      return (options.signedIn?.() ?? true) ? completed(authenticated) : completed("", 1);
    }
    return completed();
  };
}

const services: GitHubService[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) service.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

function service(run: GitHubCommandRunner): GitHubService {
  const created = createGitHubService({ run });
  services.push(created);
  return created;
}

describe("GitHub state", () => {
  it("reads the account, repository, and the checked-out branch's pull request", async () => {
    const calls: GitHubCommandRequest[] = [];
    const state = await service(machine({ remote: "git@github.com:owner/repo.git", calls })).state(
      "/workspace",
    );

    expect(state).toEqual({
      kind: "ready",
      repository: {
        owner: "owner",
        name: "repo",
        remoteName: "origin",
        url: "https://github.com/owner/repo",
      },
      account: {
        login: "octocat",
        name: "The Octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/583231",
      },
      pullRequest: {
        kind: "ready",
        pullRequest: {
          number: 12,
          title: "Fix escaping",
          url: "https://github.com/owner/repo/pull/12",
          state: "OPEN",
          draft: false,
          headRefName: "feature",
          baseRefName: "main",
        },
      },
    });
    for (const call of calls) {
      expect(call.cwd).toBe(
        call.command === "git" || call.args[0] === "pr" ? "/workspace" : homedir(),
      );
    }
  });

  it("keeps only https GitHub URLs and never a remote's credentials", async () => {
    const state = await service(
      machine({
        remote: "https://user:SECRET@github.com/owner/repo.git",
        account: { ...account, avatar_url: "https://evil.test/avatar.png" },
        pull: { ...pull, url: "https://SECRET@github.com/owner/repo/pull/12" },
      }),
    ).state("/workspace");

    expect(state).toMatchObject({
      kind: "ready",
      repository: { url: "https://github.com/owner/repo" },
      account: { login: "octocat", avatarUrl: undefined },
      pullRequest: { kind: "error" },
    });
    expect(JSON.stringify(state)).not.toMatch(/SECRET|evil/u);
  });

  it.each([
    ["no accounts", completed("", 1), "signed_out"],
    ["inactive account", completed('[{"active":false,"state":"success"}]'), "signed_out"],
    ["invalid credentials", completed('[{"active":true,"state":"error"}]'), "error"],
    ["timeout", { kind: "timeout" }, "error"],
    ["missing CLI", { kind: "missing" }, "cli_missing"],
    ["failed command", completed("SECRET stdout", 2, "SECRET stderr"), "error"],
    ["malformed JSON", completed("SECRET invalid JSON"), "error"],
    ["unsupported --json", completed("", 1, "unknown flag: --json\nSECRET"), "error"],
  ] satisfies readonly (readonly [string, GitHubCommandResult, string])[])(
    "classifies %s without leaking command output",
    async (_label, result, kind) => {
      const state = await service(async () => result).state();

      expect(state.kind).toBe(kind);
      expect(JSON.stringify(state)).not.toContain("SECRET");
    },
  );
});

async function installGh(
  body: string,
): Promise<{ readonly starts: string; readonly signal: string }> {
  const folder = await mkdtemp(join(tmpdir(), "nyte-gh-"));
  folders.push(folder);
  const starts = join(folder, "starts");
  const signal = join(folder, "signed-in");
  await writeFile(
    join(folder, "gh"),
    `#!${process.execPath}
const fs = require("node:fs");
const starts = ${JSON.stringify(starts)};
const signal = ${JSON.stringify(signal)};
fs.appendFileSync(starts, process.pid + "\\n");
${body}
`,
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", folder);
  return { starts, signal };
}

const printCode = `
process.stderr.write("! First copy your one-time code: ABCD-1234\\n");
process.stderr.write("Open this URL to continue in your web browser: https://github.com/login/device\\n");
`;

const waitForever = "setInterval(() => {}, 1000);";

async function onlyPid(starts: string): Promise<number> {
  const [pid, ...others] = (await readFile(starts, "utf8")).trim().split("\n").map(Number);
  if (pid === undefined || others.length > 0) throw new Error("Expected one gh process");
  return pid;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform === "win32")("GitHub sign-in", () => {
  it("shares one process and its device code until signOut cancels it", async () => {
    const { starts } = await installGh(printCode + waitForever);
    const calls: GitHubCommandRequest[] = [];
    const github = service(machine({ signedIn: () => false, calls }));

    const [first, second] = await Promise.all([github.signIn(), github.signIn()]);
    const joined = await github.signIn();

    for (const state of [first, second, joined, await github.state()]) {
      expect(state).toMatchObject({
        kind: "signing_in",
        deviceCode: { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" },
      });
    }
    expect(first).toMatchObject({ deviceCode: { expiresInSeconds: 900 } });
    const pid = await onlyPid(starts);

    expect(await github.signOut()).toEqual({ kind: "signed_out", repository: undefined });
    expect(calls.map((call) => call.args.slice(0, 2))).not.toContainEqual(["auth", "logout"]);
    await vi.waitFor(() => expect(isRunning(pid)).toBe(false));
    expect(await github.state()).toMatchObject({ kind: "signed_out" });
  });

  it("answers a signed-in account without starting another sign-in", async () => {
    const { starts } = await installGh(printCode + waitForever);
    const github = service(machine());

    expect(await github.signIn()).toMatchObject({ kind: "ready", account: { login: "octocat" } });
    expect(existsSync(starts)).toBe(false);
  });

  it("keeps an account signed in elsewhere when its pending sign-in is cancelled", async () => {
    await installGh(printCode + waitForever);
    let signedIn = false;
    const calls: GitHubCommandRequest[] = [];
    const github = service(machine({ signedIn: () => signedIn, calls }));

    expect(await github.signIn()).toMatchObject({ kind: "signing_in" });
    signedIn = true;
    expect(await github.signOut()).toMatchObject({ kind: "ready", account: { login: "octocat" } });
    expect(calls.map((call) => call.args.slice(0, 2))).not.toContainEqual(["auth", "logout"]);

    expect(await github.signOut()).toMatchObject({ kind: "ready" });
    expect(calls.map((call) => call.args.slice(0, 2))).toContainEqual(["auth", "logout"]);
  });

  it("ends the sign-in an owner started when it aborts, not one it joined", async () => {
    const { starts } = await installGh(printCode + waitForever);
    const github = service(machine({ signedIn: () => false }));
    const remote = new AbortController();

    expect(await github.signIn()).toMatchObject({ kind: "signing_in" });
    expect(await github.owned(remote.signal).signIn()).toMatchObject({ kind: "signing_in" });
    remote.abort();
    expect(await github.state()).toMatchObject({ kind: "signing_in" });
    const local = await onlyPid(starts);
    expect(isRunning(local)).toBe(true);
    await github.signOut();
    await vi.waitFor(() => expect(isRunning(local)).toBe(false));

    const owner = new AbortController();
    expect(await github.owned(owner.signal).signIn()).toMatchObject({ kind: "signing_in" });
    expect(await github.signIn()).toMatchObject({ kind: "signing_in" });
    owner.abort();
    expect(await github.state()).toMatchObject({ kind: "signed_out" });
    const [, second] = (await readFile(starts, "utf8")).trim().split("\n").map(Number);
    expect(second).toBeDefined();
    await vi.waitFor(() => expect(second !== undefined && isRunning(second)).toBe(false));
  });

  it("reads the account once the code is entered", async () => {
    const { signal } = await installGh(
      `${printCode}setTimeout(() => { fs.writeFileSync(signal, ""); process.exit(0); }, 200);`,
    );
    const github = service(machine({ signedIn: () => existsSync(signal) }));

    expect(await github.signIn()).toMatchObject({ kind: "signing_in" });
    await vi.waitFor(async () =>
      expect(await github.state()).toMatchObject({ kind: "ready", account: { login: "octocat" } }),
    );
  });

  it("ends the sign-in after 15 minutes", async () => {
    const { starts } = await installGh(printCode + waitForever);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const github = service(machine({ signedIn: () => false }));

    expect(await github.signIn()).toMatchObject({ deviceCode: { expiresInSeconds: 900 } });
    vi.advanceTimersByTime(15 * 60_000 - 1_000);
    expect(await github.state()).toMatchObject({
      kind: "signing_in",
      deviceCode: { expiresInSeconds: 1 },
    });
    vi.advanceTimersByTime(1_000);
    expect(await github.state()).toMatchObject({ kind: "signed_out" });
    const pid = await onlyPid(starts);
    await vi.waitFor(() => expect(isRunning(pid)).toBe(false));
  });

  it.each([
    ["a failing CLI", 'process.stderr.write("SECRET /private/path\\n"); process.exit(1);'],
    [
      "a verification page off GitHub",
      'process.stderr.write("one-time code: ABCD-1234\\nOpen https://evil.test/SECRET\\n");' +
        waitForever,
    ],
    [
      "credentials in the verification page",
      'process.stderr.write("one-time code: ABCD-1234\\nOpen https://SECRET@github.com/login/device\\n");' +
        waitForever,
    ],
  ])("reports %s without its output", async (_label, body) => {
    await installGh(body);
    const state = await service(machine({ signedIn: () => false })).signIn();

    expect(state).toMatchObject({ kind: "error", message: expect.any(String) });
    expect(JSON.stringify(state)).not.toMatch(/SECRET|private|evil/u);
  });

  it("reports a missing CLI", async () => {
    const folder = await mkdtemp(join(tmpdir(), "nyte-gh-empty-"));
    folders.push(folder);
    vi.stubEnv("PATH", folder);

    expect(await service(machine({ signedIn: () => false })).signIn()).toEqual({
      kind: "cli_missing",
      repository: undefined,
    });
  });

  it("ends a running sign-in on close and refuses new ones", async () => {
    const { starts } = await installGh(printCode + waitForever);
    const github = service(machine({ signedIn: () => false }));

    expect(await github.signIn()).toMatchObject({ kind: "signing_in" });
    github.close();
    const pid = await onlyPid(starts);
    await vi.waitFor(() => expect(isRunning(pid)).toBe(false));
    expect(await github.state()).toMatchObject({ kind: "signed_out" });
    await expect(github.signIn()).rejects.toThrow("closed");
  });
});

interface PullRequestScenario {
  /** What `gh pr view` answers for the current branch. */
  readonly existing?: boolean;
  /** What `gh pr create` answers, when it is allowed to run at all. */
  readonly create?: GitHubCommandResult;
  readonly auth?: GitHubCommandResult;
  readonly remote?: boolean;
}

const noPullRequest = completed("", 1, "no pull requests found for branch feature");

function pullRequestRunner(
  scenario: PullRequestScenario,
  calls: GitHubCommandRequest[],
): GitHubCommandRunner {
  return async (request) => {
    calls.push(request);
    if (request.command === "git") {
      if (scenario.remote === false) return completed("", 128);
      if (request.args[0] === "symbolic-ref") return completed("feature\n");
      return completed(request.args.length === 1 ? "origin\n" : "git@github.com:owner/repo.git\n");
    }
    if (request.args[0] === "api") return completed(JSON.stringify(account));
    if (request.args[1] === "view")
      return scenario.existing === true ? completed(JSON.stringify(pull)) : noPullRequest;
    if (request.args[1] === "create")
      return scenario.create ?? completed("https://github.com/owner/repo/pull/13\n");
    return scenario.auth ?? completed(authenticated);
  };
}

describe("GitHub pull request creation", () => {
  it("creates one for the checked-out branch and answers with its URL", async () => {
    const calls: GitHubCommandRequest[] = [];
    const result = await service(pullRequestRunner({}, calls)).createPullRequest(
      { title: "feat: ship it", body: "why", draft: true },
      "/workspace",
    );

    expect(result).toEqual({ kind: "created", url: "https://github.com/owner/repo/pull/13" });
    const create = calls.find((call) => call.args[1] === "create");
    expect(create).toMatchObject({ command: "gh", cwd: "/workspace" });
    expect(create?.args).toEqual([
      "pr",
      "create",
      "--repo",
      "owner/repo",
      "--title",
      "feat: ship it",
      "--body",
      "why",
      "--draft",
    ]);
  });

  it("omits --draft and sends an empty body when neither is asked for", async () => {
    const calls: GitHubCommandRequest[] = [];
    await service(pullRequestRunner({}, calls)).createPullRequest(
      { title: "feat: ship it" },
      "/workspace",
    );

    const create = calls.find((call) => call.args[1] === "create");
    expect(create?.args).not.toContain("--draft");
    expect(create?.args.slice(-2)).toEqual(["--body", ""]);
  });

  it("answers exists without creating anything when the branch already has one", async () => {
    const calls: GitHubCommandRequest[] = [];
    const result = await service(pullRequestRunner({ existing: true }, calls)).createPullRequest(
      { title: "feat: ship it" },
      "/workspace",
    );

    expect(result).toEqual({
      kind: "exists",
      pullRequest: expect.objectContaining({ number: 12 }),
    });
    expect(calls.some((call) => call.args[1] === "create")).toBe(false);
  });

  it("answers exists when another client opened one between the read and the create", async () => {
    const calls: GitHubCommandRequest[] = [];
    let opened = false;
    const run: GitHubCommandRunner = async (request) => {
      if (request.command === "gh" && request.args[1] === "create") {
        opened = true;
        return completed("", 1, "a pull request for branch feature already exists: #12");
      }
      return pullRequestRunner({ existing: opened }, calls)(request);
    };
    const result = await service(run).createPullRequest({ title: "feat: ship it" }, "/workspace");

    expect(result).toEqual({
      kind: "exists",
      pullRequest: expect.objectContaining({ number: 12 }),
    });
  });

  it.each([
    ["missing CLI", { auth: { kind: "missing" } }, { kind: "cli_missing" }],
    ["signed out", { auth: completed("", 1) }, { kind: "signed_out" }],
    ["no GitHub remote", { remote: false }, { kind: "no_remote" }],
  ] satisfies readonly (readonly [string, PullRequestScenario, unknown])[])(
    "refuses before creating anything: %s",
    async (_label, scenario, expected) => {
      const calls: GitHubCommandRequest[] = [];
      const result = await service(pullRequestRunner(scenario, calls)).createPullRequest(
        { title: "feat: ship it" },
        "/workspace",
      );

      expect(result).toEqual(expected);
      expect(calls.some((call) => call.args[1] === "create")).toBe(false);
    },
  );

  it("answers no_remote without a workspace, where there is no repository", async () => {
    const calls: GitHubCommandRequest[] = [];
    const result = await service(pullRequestRunner({}, calls)).createPullRequest({
      title: "feat: ship it",
    });

    expect(result).toEqual({ kind: "no_remote" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["a failing create", completed("SECRET stdout", 1, "SECRET stderr")],
    ["a timeout", { kind: "timeout" }],
    ["output that is not a GitHub URL", completed("https://evil.test/owner/repo/pull/13\n")],
    ["credentials in the URL", completed("https://SECRET@github.com/owner/repo/pull/13\n")],
  ] satisfies readonly (readonly [string, GitHubCommandResult])[])(
    "reports %s as failed without leaking command output",
    async (_label, create) => {
      const result = await service(pullRequestRunner({ create }, [])).createPullRequest(
        { title: "feat: ship it" },
        "/workspace",
      );

      expect(result).toMatchObject({ kind: "failed", message: expect.any(String) });
      expect(JSON.stringify(result)).not.toMatch(/SECRET|evil/u);
    },
  );
});
