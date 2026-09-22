import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createOtelExport } from "@nyte-ai/host/otel";
import { DesktopHost } from "./host.ts";
import { unusedBrowserAgent } from "./browser-stub.ts";
import {
  createGitHubProvider,
  decodeGitHubAccountOutput,
  decodeGitHubPullRequestOutput,
  runProviderCommand,
} from "./github.ts";
import type { CommandRequest, CommandResult, CommandRunner } from "./github.ts";

const authenticated = JSON.stringify([{ active: true, state: "success" }]);
const account = { login: "octocat", name: "Tabs\tand\nlines\\", avatar_url: null };
const pull = {
  number: 12,
  title: "Fix\tJSON\nescaping\\",
  url: "https://github.com/owner/repo/pull/12",
  state: "OPEN",
  isDraft: false,
  headRefName: "feature",
  baseRefName: "main",
};
const completed = (stdout = "", code = 0, stderr = ""): CommandResult => ({
  kind: "completed",
  code,
  stdout,
  stderr,
});

describe("GitHub JSON boundary", () => {
  it("preserves JSON strings and nullable account fields", () => {
    expect(decodeGitHubAccountOutput(JSON.stringify(account))).toEqual({
      login: "octocat",
      name: account.name,
      avatarUrl: undefined,
    });
    expect(decodeGitHubPullRequestOutput(JSON.stringify(pull))).toEqual({
      number: 12,
      title: pull.title,
      url: pull.url,
      state: "OPEN",
      draft: false,
      headRefName: "feature",
      baseRefName: "main",
    });
  });
  it.each(["{", "null", "[]", '{"login":12}'])("rejects invalid account output %s", (output) => {
    expect(decodeGitHubAccountOutput(output)).toBeUndefined();
  });
  it.each([
    { number: 1.5 },
    { number: 0 },
    { isDraft: "false" },
    { state: "UNKNOWN" },
    { url: "https://evil.test/pr/12" },
    { headRefName: "" },
  ])("rejects invalid PR fields %j", (fields) => {
    expect(decodeGitHubPullRequestOutput(JSON.stringify({ ...pull, ...fields }))).toBeUndefined();
  });
});

it("reads account and changes auth at Home without git or cached state", async () => {
  let signedIn = false;
  const calls: CommandRequest[] = [];
  const run: CommandRunner = async (request) => {
    calls.push(request);
    expect(request.command).toBe("gh");
    expect(request.cwd).toBe(homedir());
    if (request.args[0] === "api") return completed(JSON.stringify(account));
    if (request.args[1] === "login") {
      expect(request.args).toContain("--web");
      expect(request.args).toContain("--clipboard");
      signedIn = true;
    }
    if (request.args[1] === "logout") signedIn = false;
    if (request.args[1] === "status") return signedIn ? completed(authenticated) : completed("", 1);
    return completed();
  };
  const provider = createGitHubProvider(undefined, run);
  expect(calls).toHaveLength(0);
  expect(await provider.state()).toEqual({ kind: "signed_out", repository: undefined });
  expect(await provider.signIn()).toMatchObject({
    kind: "ready",
    repository: undefined,
    account: { login: "octocat" },
    pullRequest: { kind: "none" },
  });
  signedIn = false;
  expect(await provider.state()).toMatchObject({ kind: "signed_out" });
  expect(await provider.signOut()).toMatchObject({ kind: "signed_out" });
});

it.each(["feature", undefined])(
  "queries the explicit current branch, not a detached HEAD: %s",
  async (branch) => {
    const run: CommandRunner = async (request) => {
      if (request.command === "git") {
        expect(request.cwd).toBe("/workspace");
        if (request.args[0] === "symbolic-ref")
          return completed(branch ?? "", branch === undefined ? 1 : 0);
        return completed(
          request.args.length === 1 ? "origin\n" : "git@github.com:owner/repo.git\n",
        );
      }
      if (request.args[0] === "api") {
        expect(request.cwd).toBe(homedir());
        return completed(JSON.stringify(account));
      }
      if (request.args[0] === "pr") {
        expect(request.cwd).toBe("/workspace");
        expect(branch).toBeDefined();
        expect(request.args.slice(0, 5)).toEqual(["pr", "view", "feature", "--repo", "owner/repo"]);
        return completed(JSON.stringify(pull));
      }
      expect(request.cwd).toBe(homedir());
      return completed(authenticated);
    };
    const state = await createGitHubProvider("/workspace", run).state();
    expect(state).toMatchObject({
      kind: "ready",
      pullRequest:
        branch === undefined ? { kind: "none" } : { kind: "ready", pullRequest: { number: 12 } },
    });
  },
);

it("keeps accounts available in a folder without a GitHub remote", async () => {
  const run: CommandRunner = async (request) =>
    request.command === "git"
      ? completed("", 128)
      : completed(request.args[0] === "api" ? JSON.stringify(account) : authenticated);
  expect(await createGitHubProvider("/workspace", run).state()).toMatchObject({
    kind: "ready",
    repository: undefined,
    pullRequest: { kind: "none" },
  });
});

describe("GitHub auth status", () => {
  it.each([
    ["empty stdout, exit 0", completed(), "signed_out"],
    ["empty stdout, exit 1", completed("", 1), "signed_out"],
    ["no accounts", completed("[]"), "signed_out"],
    ["inactive account", completed('[{"active":false,"state":"success"}]'), "signed_out"],
    ["invalid credentials", completed('[{"active":true,"state":"error"}]'), "error"],
    ["host timeout", completed('[{"active":true,"state":"timeout"}]'), "error"],
    ["process timeout", { kind: "timeout" }, "error"],
    ["missing CLI", { kind: "missing" }, "cli_missing"],
    ["fatal exit", completed("", 2), "error"],
    ["failed command", completed(authenticated, 1), "error"],
    ["malformed JSON", completed("SECRET invalid JSON"), "error"],
    ["wrong shape", completed('{"active":true,"state":"success"}'), "error"],
    ["wrong active type", completed('[{"active":"true","state":"success"}]'), "error"],
    ["unknown state", completed('[{"active":true,"state":"SECRET"}]'), "error"],
  ] satisfies readonly (readonly [string, CommandResult, string])[])(
    "classifies %s without reading the account",
    async (_label, result, kind) => {
      const run: CommandRunner = vi.fn(async (request) => {
        expect(request.args).toEqual([
          "auth",
          "status",
          "--hostname",
          "github.com",
          "--json",
          "hosts",
          "--jq",
          '[.hosts["github.com"][] | {active, state}]',
        ]);
        expect(request.cwd).toBe(homedir());
        return result;
      });
      const state = await createGitHubProvider(undefined, run).state();
      expect(state.kind).toBe(kind);
      expect(run).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(state)).not.toContain("SECRET");
    },
  );

  it.each(["json", "jq"])("suggests upgrading for unsupported --%s", async (flag) => {
    const state = await createGitHubProvider(undefined, async () =>
      completed("", 1, `unknown flag: --${flag}\nSECRET raw output`),
    ).state();
    expect(state).toMatchObject({
      kind: "error",
      message: expect.stringContaining("Update the GitHub CLI"),
    });
    expect(JSON.stringify(state)).not.toContain("SECRET");
  });

  it("uses the active account even when an inactive account failed", async () => {
    const state = await createGitHubProvider(undefined, async (request) =>
      completed(
        request.args[0] === "api"
          ? JSON.stringify(account)
          : JSON.stringify([
              { active: false, state: "error" },
              { active: true, state: "success" },
            ]),
      ),
    ).state();
    expect(state).toMatchObject({ kind: "ready", account: { login: "octocat" } });
  });
});

const folders: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

it("keeps account and auth commands available after the workspace is deleted", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "nyte-github-deleted-"));
  await rm(workspace, { recursive: true });
  let signedIn = true;
  const run: CommandRunner = async (request) => {
    if (request.command === "git") {
      expect(request.cwd).toBe(workspace);
      return runProviderCommand(request);
    }
    expect(request.cwd).toBe(homedir());
    if (request.args[0] === "api") return completed(JSON.stringify(account));
    if (request.args[1] === "logout") signedIn = false;
    if (request.args[1] === "login") signedIn = true;
    return completed(signedIn ? authenticated : "[]");
  };
  const provider = createGitHubProvider(workspace, run);
  expect(await provider.state()).toMatchObject({ kind: "ready", repository: undefined });
  expect(await provider.signOut()).toMatchObject({ kind: "signed_out" });
  expect(await provider.signIn()).toMatchObject({ kind: "ready", repository: undefined });
});

it.skipIf(process.platform === "win32")(
  "runs local git and bounds noisy or stuck subprocesses",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nyte-github-"));
    folders.push(cwd);
    expect(
      await runProviderCommand({ command: "git", args: ["init", "--quiet"], cwd, timeoutMs: 3000 }),
    ).toMatchObject({ kind: "completed", code: 0 });
    for (const [script, kind] of [
      ["process.stdout.write('ok'); process.stderr.write('err')", "completed"],
      ["process.on('SIGTERM',()=>{}); setInterval(()=>{},100)", "timeout"],
      [
        "process.on('SIGTERM',()=>{}); setInterval(()=>process.stdout.write('x'.repeat(100000)),1)",
        "output_limit",
      ],
    ] as const) {
      await writeFile(
        join(cwd, "gh"),
        `#!${process.execPath}
${script}
`,
        { mode: 0o755 },
      );
      vi.stubEnv("PATH", cwd);
      const result = await runProviderCommand({
        command: "gh",
        args: [],
        cwd,
        timeoutMs: kind === "timeout" ? 200 : 3000,
      });
      expect(result).toMatchObject({ kind });
      if (kind === "completed")
        expect(result).toMatchObject({ stdout: "ok", stderr: "err", code: 0 });
    }
  },
);

it("serves GitHub from Home and never sends command output or exceptions to telemetry", async () => {
  const recorded: unknown[] = [];
  const operations: Parameters<ReturnType<typeof createOtelExport>["telemetry"]["startSpan"]>[0][] =
    [];
  const telemetry: ReturnType<typeof createOtelExport>["telemetry"] = {
    async startSpan(options, fn) {
      recorded.push(options);
      operations.push(options);
      return fn({
        ...telemetry,
        setAttributes: (attributes) => {
          recorded.push(attributes);
        },
        setStatus: (status) => {
          recorded.push(status);
        },
        addEvent: () => {},
      });
    },
  };
  const events: unknown[] = [];
  let healthy = false;
  const host = new DesktopHost({
    storeWorker: new URL("../../../core/src/kernel/store-worker.ts", import.meta.url),
    createOtelExport: () => ({ telemetry, shutdown: async () => {} }),
    createModels: () => {
      throw new Error("Must not compose storage");
    },
    emitHostEvent: (event) => {
      events.push(event);
    },
    emitWatchEvent: () => {},
    openExternal: () => {},
    revealPath: () => undefined,
    showContextMenu: () => Promise.resolve(undefined),
    listFonts: async () => ({ sans: [], monospace: [] }),
    pickFolder: async () => undefined,
    browser: {
      open: () => {
        throw new Error("Unused");
      },
      navigate: () => {},
      close: () => {},
      captureFrame: () => Promise.resolve(undefined),
      setBounds: () => {},
      retain: () => {},
      release: () => {},
      warm: async () => {},
      releaseWindow: () => undefined,
      menu: async () => undefined,
      perform: async () => {},
      agent: unusedBrowserAgent(),
    },
    runGitHubCommand: async (request) => {
      expect(request.cwd).toBe(homedir());
      if (request.args[1] === "login") throw new Error("SECRET /private/path https://secret.test");
      if (healthy) {
        return completed(request.args[0] === "api" ? JSON.stringify(account) : authenticated);
      }
      return completed("SECRET stdout", 1, "SECRET stderr");
    },
  });
  try {
    expect(await host.call(1, "host.github.state", undefined)).toMatchObject({ kind: "error" });
    expect(await host.call(1, "host.github.signIn", undefined)).toMatchObject({ kind: "error" });
    expect(events).toContainEqual({ kind: "github_changed" });
    expect(recorded).toContainEqual({
      name: "desktop.github.command",
      attributes: { operation: "gh.auth.status" },
    });
    expect(recorded).toContainEqual({
      outcome: "completed",
      code: 1,
      duration_ms: expect.any(Number),
    });
    expect(recorded).toContainEqual({
      outcome: "failed",
      code: undefined,
      duration_ms: expect.any(Number),
    });
    healthy = true;
    expect(await host.call(1, "host.github.state", undefined)).toMatchObject({ kind: "ready" });
    expect(await host.call(1, "host.github.signOut", undefined)).toMatchObject({ kind: "ready" });
    for (const entry of operations) {
      expect(entry).toMatchObject({
        name: "desktop.github.command",
        attributes: {
          operation: expect.stringMatching(/^gh\.(?:api|auth\.(?:status|login|logout))$/u),
        },
      });
    }
    expect(operations).toContainEqual({
      name: "desktop.github.command",
      attributes: { operation: "gh.api" },
    });
    expect(operations).toContainEqual({
      name: "desktop.github.command",
      attributes: { operation: "gh.auth.logout" },
    });
    expect(JSON.stringify(recorded)).not.toMatch(
      /SECRET|private|secret\.test|--hostname|octocat|github\.com\b/u,
    );
  } finally {
    await host.close();
  }
});

interface PullRequestScenario {
  /** What `gh pr view` answers for the current branch. */
  readonly existing?: boolean;
  /** What `gh pr create` answers, when it is allowed to run at all. */
  readonly create?: CommandResult;
  readonly auth?: CommandResult;
  readonly remote?: boolean;
  readonly branch?: string;
}

const noPullRequest = completed("", 1, "no pull requests found for branch feature");

function pullRequestRunner(scenario: PullRequestScenario, calls: CommandRequest[]): CommandRunner {
  return async (request) => {
    calls.push(request);
    if (request.command === "git") {
      if (scenario.remote === false) return completed("", 128);
      if (request.args[0] === "symbolic-ref") {
        const branch = scenario.branch ?? "feature";
        return completed(branch, branch === "" ? 1 : 0);
      }
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
  it("creates a pull request for the checked-out branch and answers with its URL", async () => {
    const calls: CommandRequest[] = [];
    const result = await createGitHubProvider(
      "/workspace",
      pullRequestRunner({}, calls),
    ).createPullRequest({ title: "feat: ship it", body: "why", draft: true });

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
    const calls: CommandRequest[] = [];
    await createGitHubProvider("/workspace", pullRequestRunner({}, calls)).createPullRequest({
      title: "feat: ship it",
    });

    const create = calls.find((call) => call.args[1] === "create");
    expect(create?.args).not.toContain("--draft");
    expect(create?.args.slice(-2)).toEqual(["--body", ""]);
  });

  it("answers exists without creating anything when the branch already has one", async () => {
    const calls: CommandRequest[] = [];
    const result = await createGitHubProvider(
      "/workspace",
      pullRequestRunner({ existing: true }, calls),
    ).createPullRequest({ title: "feat: ship it" });

    expect(result).toEqual({
      kind: "exists",
      pullRequest: expect.objectContaining({ number: 12 }),
    });
    expect(calls.some((call) => call.args[1] === "create")).toBe(false);
  });

  it("answers exists when another client opened one between the read and the create", async () => {
    const calls: CommandRequest[] = [];
    let opened = false;
    const run: CommandRunner = async (request) => {
      const inner = pullRequestRunner({ existing: opened }, calls);
      if (request.command === "gh" && request.args[1] === "create") {
        calls.push(request);
        opened = true;
        return completed("", 1, "a pull request for branch feature already exists: #12");
      }
      return inner(request);
    };
    const result = await createGitHubProvider("/workspace", run).createPullRequest({
      title: "feat: ship it",
    });

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
      const calls: CommandRequest[] = [];
      const result = await createGitHubProvider(
        "/workspace",
        pullRequestRunner(scenario, calls),
      ).createPullRequest({ title: "feat: ship it" });

      expect(result).toEqual(expected);
      expect(calls.some((call) => call.args[1] === "create")).toBe(false);
    },
  );

  it("answers no_remote at Home, where there is no repository to open one for", async () => {
    const calls: CommandRequest[] = [];
    const result = await createGitHubProvider(
      undefined,
      pullRequestRunner({}, calls),
    ).createPullRequest({ title: "feat: ship it" });

    expect(result).toEqual({ kind: "no_remote" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["a failing create", completed("SECRET stdout", 1, "SECRET stderr")],
    ["a timeout", { kind: "timeout" }],
    ["output that is not a GitHub URL", completed("https://evil.test/owner/repo/pull/13\n")],
  ] satisfies readonly (readonly [string, CommandResult])[])(
    "reports %s as failed without leaking command output",
    async (_label, create) => {
      const result = await createGitHubProvider(
        "/workspace",
        pullRequestRunner({ create }, []),
      ).createPullRequest({ title: "feat: ship it" });

      expect(result).toMatchObject({ kind: "failed", message: expect.any(String) });
      expect(JSON.stringify(result)).not.toContain("SECRET");
      expect(JSON.stringify(result)).not.toContain("evil.test");
    },
  );
});
