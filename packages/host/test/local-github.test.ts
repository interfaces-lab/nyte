import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { asId } from "@nyte-ai/schema";
import type { ExecutionEnv, GitHubApi } from "@nyte-ai/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localExec, localFiles, localGitHub, localGitHubAccount } from "../src/index.ts";

const FAKE_GH = fileURLToPath(new URL("fixtures/gh", import.meta.url));

const folders: string[] = [];

let scenarioFile = "";

beforeEach(async () => {
  const state = await folder();
  scenarioFile = join(state, "scenario.json");
  vi.stubEnv("PATH", `${FAKE_GH}${delimiter}${process.env.PATH ?? ""}`);
  vi.stubEnv("NYTE_FAKE_GH", scenarioFile);
});

afterEach(async () => {
  vi.unstubAllEnvs();

  for (const made of folders.splice(0))
    await rm(made, { recursive: true, force: true, maxRetries: 10 });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-github-")));
  folders.push(made);

  return made;
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
}

type Pull = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly isDraft: boolean;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly statusCheckRollup: readonly Readonly<Record<string, string | null>>[];
};

type Scenario = {
  readonly auth: "ready" | "signed_out" | "invalid";
  readonly login?: string;
  readonly cli?: "old";
  readonly api?: "fail";
  readonly create?: "fail";
  readonly pulls?: Readonly<Record<string, Pull>>;
};

async function scenario(value: Scenario): Promise<void> {
  await writeFile(scenarioFile, JSON.stringify({ login: "octocat", ...value }));
}

async function calls(): Promise<
  readonly { readonly args: readonly string[]; readonly stdin: string }[]
> {
  const log = await readFile(`${scenarioFile}.log`, "utf8").catch(() => "");

  return log
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

/** A repository on `feature` with one commit and the given remotes. */
async function repository(remotes: Readonly<Record<string, string>>): Promise<string> {
  const root = await folder();
  sh(root, "init", "-q", "-b", "feature");
  sh(root, "config", "user.name", "Ada");
  sh(root, "config", "user.email", "ada@example.com");
  sh(root, "config", "commit.gpgsign", "false");
  await writeFile(join(root, "a.txt"), "one\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "first");

  for (const [name, url] of Object.entries(remotes)) sh(root, "remote", "add", name, url);

  return root;
}

function github(cwd: string, gh?: string): GitHubApi {
  const env: ExecutionEnv = {
    identity: asId("test"),
    cwd,
    files: localFiles(cwd),
    exec: localExec(cwd),
    close: async () => undefined,
  };

  return localGitHub({ gh })(env);
}

const HELLO = {
  owner: "octo",
  name: "hello",
  remoteName: "origin",
  url: "https://github.com/octo/hello",
};

const openPull: Pull = {
  number: 12,
  title: "Fix tab close",
  url: "https://github.com/octo/hello/pull/12",
  state: "OPEN",
  isDraft: false,
  headRefName: "feature",
  baseRefName: "main",
  statusCheckRollup: [
    {
      __typename: "CheckRun",
      name: "lint",
      status: "COMPLETED",
      conclusion: "SUCCESS",
      detailsUrl: "https://github.com/octo/hello/actions/runs/1",
    },
    {
      __typename: "CheckRun",
      name: "test",
      status: "COMPLETED",
      conclusion: "FAILURE",
      detailsUrl: "https://github.com/octo/hello/actions/runs/2",
    },
    {
      __typename: "CheckRun",
      name: "e2e",
      status: "IN_PROGRESS",
      conclusion: "",
      detailsUrl: null,
    },
    { __typename: "CheckRun", name: "docs", status: "COMPLETED", conclusion: "SKIPPED" },
    {
      __typename: "StatusContext",
      context: "ci/buildkite",
      state: "PENDING",
      targetUrl: "http://insecure.example/build",
    },
  ],
};

describe("localGitHub", () => {
  it("answers cli_missing with the repository when no gh is on the PATH, and opens nothing", async () => {
    const root = await repository({ origin: "git@github.com:octo/hello.git" });
    const api = github(root, "nyte-no-such-gh");
    const account = localGitHubAccount({ gh: "nyte-no-such-gh", home: root });

    expect(await api.state()).toEqual({ repository: HELLO, pullRequest: { kind: "unavailable" } });
    expect(await api.createPullRequest({ title: "Fix" })).toEqual({ kind: "cli_missing" });
    expect(await account.account()).toEqual({ kind: "cli_missing" });
    expect(await account.signIn()).toEqual({ kind: "cli_missing" });
  });

  it("answers signed_out, and a pull request without a login is refused before gh runs it", async () => {
    const root = await repository({ origin: "https://github.com/octo/hello.git" });
    await scenario({ auth: "signed_out" });

    expect(await github(root).state()).toEqual({
      repository: HELLO,
      pullRequest: { kind: "unavailable" },
    });
    expect(await localGitHubAccount({ home: root }).account()).toEqual({ kind: "signed_out" });
    expect(await github(root).createPullRequest({ title: "Fix" })).toEqual({
      kind: "signed_out",
    });
    expect((await calls()).some((call) => call.args[1] === "create")).toBe(false);
  });

  it("says what to do for a rejected login, a gh too old for --json, and an unreachable API", async () => {
    const root = await repository({ origin: "https://github.com/octo/hello" });

    const account = localGitHubAccount({ home: root });

    await scenario({ auth: "invalid" });
    expect(await account.account()).toMatchObject({
      kind: "error",
      message: expect.stringContaining("gh auth login"),
    });

    await scenario({ auth: "ready", cli: "old" });
    expect(await account.account()).toEqual({
      kind: "error",
      message: "Update the GitHub CLI (gh), then try again.",
    });
    expect(await github(root).createPullRequest({ title: "Fix" })).toEqual({
      kind: "failed",
      message: "Update the GitHub CLI (gh), then try again.",
    });

    await scenario({ auth: "ready", api: "fail" });
    expect(await account.account()).toEqual({
      kind: "error",
      message: "Couldn't reach GitHub. Try again.",
    });
  });

  it("reads no repository from a folder without a github.com remote, and answers no_remote", async () => {
    const root = await repository({ origin: "https://gitlab.com/octo/hello.git" });
    await scenario({ auth: "ready" });

    expect(await github(root).state()).toEqual({ pullRequest: { kind: "none" } });
    expect(await localGitHubAccount({ home: root }).account()).toEqual({
      kind: "ready",
      account: {
        login: "octocat",
        name: "The Octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
      },
    });
    expect(await github(root).createPullRequest({ title: "Fix" })).toEqual({ kind: "no_remote" });
  });

  it("reads the branch's pull request with its checks folded to four states and only https links", async () => {
    const root = await repository({
      origin: "https://github.com/octo/hello.git",
      mirror: "https://gitlab.com/octo/hello.git",
    });

    await scenario({ auth: "ready", pulls: { feature: openPull } });

    const state = await github(root).state();

    expect(state).toMatchObject({
      repository: HELLO,
      pullRequest: {
        kind: "ready",
        pullRequest: {
          number: 12,
          title: "Fix tab close",
          url: "https://github.com/octo/hello/pull/12",
          state: "OPEN",
          draft: false,
          headRefName: "feature",
          baseRefName: "main",
          checks: [
            { name: "lint", state: "passed", url: "https://github.com/octo/hello/actions/runs/1" },
            { name: "test", state: "failed", url: "https://github.com/octo/hello/actions/runs/2" },
            { name: "e2e", state: "pending" },
            { name: "docs", state: "skipped" },
            { name: "ci/buildkite", state: "pending" },
          ],
        },
      },
    });
    expect((await calls()).find((call) => call.args[1] === "view")?.args).toEqual([
      "pr",
      "view",
      "feature",
      "--repo",
      "octo/hello",
      "--json",
      "number,title,url,state,isDraft,headRefName,baseRefName,statusCheckRollup",
    ]);
  });

  it("answers exists for an open pull request and opens none", async () => {
    const root = await repository({ origin: "https://github.com/octo/hello.git" });
    await scenario({ auth: "ready", pulls: { feature: openPull } });

    expect(await github(root).createPullRequest({ title: "Again" })).toMatchObject({
      kind: "exists",
      pullRequest: { number: 12, state: "OPEN" },
    });
    expect((await calls()).some((call) => call.args[1] === "create")).toBe(false);
  });

  it("opens one with the title as an argument and the body on stdin, even after a merged one", async () => {
    const root = await repository({ origin: "https://github.com/octo/hello.git" });

    await scenario({
      auth: "ready",
      pulls: { feature: { ...openPull, state: "MERGED", statusCheckRollup: [] } },
    });

    expect(
      await github(root).createPullRequest({
        title: "Fix tab close",
        body: "Closing a tab no longer\nloses the draft.",
      }),
    ).toEqual({ kind: "created", url: "https://github.com/octo/hello/pull/7" });

    const create = (await calls()).find((call) => call.args[1] === "create");

    expect(create).toEqual({
      args: [
        "pr",
        "create",
        "--repo",
        "octo/hello",
        "--head",
        "feature",
        "--title",
        "Fix tab close",
        "--body-file",
        "-",
      ],
      stdin: "Closing a tab no longer\nloses the draft.",
    });
    expect(await github(root).state()).toMatchObject({
      pullRequest: { kind: "ready", pullRequest: { number: 7, title: "Fix tab close" } },
    });
  });

  it("lets gh fill what the input leaves out from the commits, and reports a failed create", async () => {
    const root = await repository({ origin: "https://github.com/octo/hello.git" });
    await scenario({ auth: "ready", create: "fail" });

    expect(await github(root).createPullRequest({ draft: true })).toEqual({
      kind: "failed",
      message: "Couldn't open a pull request. Run gh pr create in a terminal to see why.",
    });
    expect((await calls()).find((call) => call.args[1] === "create")?.args).toEqual([
      "pr",
      "create",
      "--repo",
      "octo/hello",
      "--head",
      "feature",
      "--fill",
      "--draft",
    ]);

    await github(root).createPullRequest({ title: "Fix tab close" });
    expect((await calls()).findLast((call) => call.args[1] === "create")?.args).toEqual([
      "pr",
      "create",
      "--repo",
      "octo/hello",
      "--head",
      "feature",
      "--title",
      "Fix tab close",
      "--fill",
    ]);

    await github(root).createPullRequest({ body: "Closing a tab keeps the draft." });
    expect((await calls()).findLast((call) => call.args[1] === "create")).toEqual({
      args: [
        "pr",
        "create",
        "--repo",
        "octo/hello",
        "--head",
        "feature",
        "--body-file",
        "-",
        "--fill",
      ],
      stdin: "Closing a tab keeps the draft.",
    });
  });

  it("names a branch that tracks a fork by its owner, against the upstream repository", async () => {
    const root = await repository({
      origin: "https://github.com/ada/hello.git",
      upstream: "https://github.com/octo/hello.git",
    });

    sh(root, "config", "branch.feature.remote", "origin");
    await scenario({ auth: "ready", pulls: { "ada:feature": openPull } });

    expect(await github(root).state()).toMatchObject({
      repository: { ...HELLO, remoteName: "upstream" },
      pullRequest: { kind: "ready", pullRequest: { number: 12 } },
    });
    expect(await github(root).createPullRequest({ title: "Fix" })).toMatchObject({
      kind: "exists",
    });
  });

  it("has no pull request on a detached HEAD and refuses to open one", async () => {
    const root = await repository({ origin: "https://github.com/octo/hello.git" });
    sh(root, "checkout", "-q", "--detach");
    await scenario({ auth: "ready", pulls: { feature: openPull } });

    expect(await github(root).state()).toMatchObject({ pullRequest: { kind: "none" } });
    expect(await github(root).createPullRequest({ title: "Fix" })).toEqual({ kind: "detached" });
  });

  it("signs in through one gh auth login for the machine, shows its code, and is ready once it is entered", async () => {
    const root = await repository({ origin: "https://github.com/octo/hello.git" });
    await scenario({ auth: "signed_out" });
    const account = localGitHubAccount({ home: await folder() });
    const signingIn = await account.signIn();

    expect(signingIn).toMatchObject({
      kind: "signing_in",
      deviceCode: { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" },
    });
    expect(await account.signIn()).toMatchObject({ kind: "signing_in" });
    expect((await calls()).filter((call) => call.args[1] === "login")).toHaveLength(1);

    await writeFile(`${scenarioFile}.approved`, "");
    await vi.waitFor(async () => expect(await account.account()).toMatchObject({ kind: "ready" }), {
      timeout: 5_000,
    });
    expect(await github(root).state()).toMatchObject({ repository: HELLO });

    expect(await account.signOut()).toEqual({ kind: "signed_out" });
    expect((await calls()).find((call) => call.args[1] === "logout")?.args).toEqual([
      "auth",
      "logout",
      "--hostname",
      "github.com",
      "--user",
      "octocat",
    ]);
  });

  it("cancels a sign-in still waiting for its code on sign-out, leaving the login as it was", async () => {
    await scenario({ auth: "signed_out" });
    const account = localGitHubAccount({ home: await folder() });

    expect(await account.signIn()).toMatchObject({ kind: "signing_in" });
    expect(await account.signOut()).toEqual({ kind: "signed_out" });
    expect(await account.account()).toEqual({ kind: "signed_out" });
  });
});
