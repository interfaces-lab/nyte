#!/usr/bin/env bun
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { openApprovals } from "@nyte-ai/plugin/approvals/schema";
import { isPart, text } from "@nyte-ai/plugin/core";
import { sdk } from "@nyte-ai/sdk/client";
import { findRunningHost, hostFilePath } from "@nyte-ai/tui/host-endpoint";

const root = fileURLToPath(new URL("../", import.meta.url));

const USAGE = `Usage: pnpm release [major|minor|patch|<version>]
       pnpm release --print [--from <tag>] [--to <ref>]

Writes the release notes in a Nyte session, opens them in your editor, and asks before it
starts the Release workflow on main. The editor is $VISUAL, then $EDITOR, then vi. It refuses
to run while HEAD has commits that origin/main lacks.

The session runs on the \`nyte host\` named in ~/.nyte/host.json, or on one started from
~/.nyte/bin/nyte (NYTE_BINARY overrides) and stopped afterwards.

Options:
  --from <tag>  Previous release (default: the latest stable v<x.y.z> tag before --to)
  --to <ref>    Last commit to describe (default: origin/main, which the workflow releases)
  --print       Print the generated notes and exit without releasing; allowed with unpushed commits
  -h, --help    Show this help`;

const BUMPS = ["major", "minor", "patch"];

const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const NOTES = /<!-- changelog:start -->\s*([\s\S]*?)\s*<!-- changelog:end -->/u;

const AGENT = "release-notes";

const BINARY = process.env["NYTE_BINARY"] ?? join(homedir(), ".nyte", "bin", "nyte");

/** The host's user plugin directory is `<home>/.nyte/plugins`, whatever NYTE_HOME says. */
const GUARD = join(homedir(), ".nyte", "plugins", AGENT, "guard.mjs");

const HOST_START_MS = 30_000;

const HOST_STOP_MS = 12_000;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    from: { type: "string" },
    to: { type: "string" },
    print: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const target = positionals[0] ?? "patch";

if (positionals.length > 1 || (!BUMPS.includes(target) && !VERSION.test(target))) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(1);
}

const input = BUMPS.includes(target) ? `bump=${target}` : `version=${target}`;

process.chdir(root);

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

git("fetch", "--quiet", "--tags", "origin", "+refs/heads/main:refs/remotes/origin/main");

const unpushed = git("log", "--oneline", "origin/main..HEAD");

if (unpushed !== "" && !values.print) {
  process.stderr.write(
    `The workflow releases origin/main, which lacks these commits from HEAD:\n${unpushed}\nPush or drop them, then retry.\n`,
  );
  process.exit(1);
}

const head = values.to ?? "origin/main";

const base =
  values.from ??
  git(
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v[0-9]*.[0-9]*.[0-9]*",
    "--exclude",
    "*-*",
    head,
  );

const version = BUMPS.includes(target)
  ? execFileSync(process.execPath, ["scripts/release-version.mjs", "resolve", "--bump", target], {
      encoding: "utf8",
    })
      .trim()
      .replace(/^version=/u, "")
  : target;

process.stderr.write(`Describing ${base}..${head} for v${version}\n`);

const review = await writeReview(base, head).catch((cause) => {
  process.stderr.write(`error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});

if (values.print) {
  process.stdout.write(`${review}\n`);
  process.exit(0);
}

const file = join(tmpdir(), `nyte-release-v${version}.md`);

writeFileSync(file, `${review}\n`);

const editor = spawnSync("sh", ["-c", 'exec ${VISUAL:-${EDITOR:-vi}} "$1"', "release", file], {
  stdio: "inherit",
});

if (editor.status !== 0) {
  process.stderr.write("Release cancelled: the editor exited with an error.\n");
  process.exit(1);
}

const notes = NOTES.exec(readFileSync(file, "utf8"))?.[1]?.trim() ?? "";

if (notes === "") {
  process.stderr.write(`Release cancelled: ${file} has no notes between the changelog markers.\n`);
  process.exit(1);
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });

const answer = await prompt.question(`Start the v${version} release from main? [y/N] `);

prompt.close();

if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
  process.stdout.write("Release cancelled.\n");
  process.exit(0);
}

execFileSync(
  "gh",
  ["workflow", "run", "release.yml", "--ref", "main", "-f", input, "-f", `release_notes=${notes}`],
  { stdio: "inherit" },
);

process.stdout.write(`Started the v${version} release. Watch it with: gh run watch\n`);

/** The host to run the session on: the `nyte host` named in host.json, else one started from the installed binary and stopped once the notes are written. */
async function attachHost() {
  const path = hostFilePath();
  const running = await findRunningHost(path);

  if (running !== null) return { host: running, started: false, stop: async () => undefined };

  if (!existsSync(BINARY))
    throw new Error(`No installed nyte at ${BINARY}. Run \`pnpm install:nyte\`, then retry.`);

  if (spawnSync(BINARY, ["host", "--help"], { stdio: "ignore" }).status !== 0)
    throw new Error(
      `${BINARY} is too old to run \`nyte host\`. Run \`pnpm install:nyte\` or \`nyte update\`, then retry.`,
    );

  const child = spawn(BINARY, ["host", "--json"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4_096);
  });

  const exited = new Promise((resolve) => child.once("exit", resolve));

  const stop = async () => {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), HOST_STOP_MS);
    await exited;
    clearTimeout(timer);
  };

  for (let waited = 0; waited < HOST_START_MS; waited += 100) {
    const host = await findRunningHost(path);

    if (host !== null && host.pid === child.pid) return { host, started: true, stop };

    if (child.exitCode !== null)
      throw new Error(`${BINARY} host exited with ${String(child.exitCode)}.\n${stderr.trim()}`);
    await sleep(100);
  }

  await stop();
  throw new Error(
    `${BINARY} host didn't publish ${path} within ${String(HOST_START_MS / 1_000)} s.`,
  );
}

/** Copies the guard into the host's user plugin directory, where `plugins.replace` may load it. A folder without an `index` file isn't loaded for every session, so the guard applies only where it is assigned. */
function placeGuard() {
  const source = readFileSync(join(root, "scripts", "release-guard.mjs"), "utf8");

  if (existsSync(GUARD) && readFileSync(GUARD, "utf8") === source) return;
  mkdirSync(dirname(GUARD), { recursive: true });
  writeFileSync(GUARD, source);
}

/**
 * Runs the release-notes session on the attached host and returns its reply. `sessions.start`
 * runs its first message at once, before a plugin can be assigned to the session, so the first
 * message only asks for a one-word reply; the guard is assigned before that turn settles and the
 * real prompt goes second. Selecting the guard's agent fails unless the guard loaded. A call the
 * guard lets through may still wait on the host's permissions policy, so approvals are answered here.
 */
async function writeReview(from, to) {
  placeGuard();
  const attached = await attachHost();

  process.stderr.write(
    `${attached.started ? "Started" : "Attached to"} the Nyte host at ${attached.host.url}\n`,
  );

  try {
    const connection = await sdk.connect({
      url: attached.host.url,
      credentials: { kind: "token", token: attached.host.token },
    });

    try {
      return await runSession(connection, from, to);
    } finally {
      await connection.close();
    }
  } finally {
    await attached.stop();
  }
}

async function runSession(connection, from, to) {
  const added = await connection.workspaces.add({ kind: "local", path: root });

  if (added.kind !== "added" && added.kind !== "exists")
    throw new Error(`The host can't open ${root} as a workspace (${added.kind}).`);

  const { session, receipt: ready } = await connection.sessions.start({
    name: `Release notes for v${version}`,
    workspace: added.workspace,
    content: "Reply with only the word: ready.",
  });

  const report = await connection.plugins.replace([{ path: GUARD }], { session: session.id });
  const guard = report.plugins.find((outcome) => outcome.id === AGENT);

  if (guard?.kind !== "activated")
    throw new Error(
      `The release guard didn't load: ${guard?.issues.map((issue) => issue.message).join("; ") ?? "missing from the report"}`,
    );
  await ready.settled();

  const configured = await session.configure({ agent: AGENT });

  if (configured.kind !== "configured")
    throw new Error(`Session ${session.id} refused the ${AGENT} agent (${configured.kind}).`);

  const receipt = await session.send(reviewPrompt(from, to));
  const answered = new Set();

  process.stderr.write(
    `Writing the notes in session ${session.id}. Watch it with: nyte --session=${session.id}\n`,
  );

  for await (const view of session.watch()) {
    for (const approval of openApprovals(view)) {
      if (answered.has(approval.part)) continue;
      answered.add(approval.part);
      await session.part(approval.part).act("once", {});
    }

    const turn = view.turns.find((candidate) => candidate.prompt === receipt.message);

    if (turn === undefined || turn.state.kind !== "ended") continue;
    const { end } = turn.state;

    if (end.kind === "failed")
      throw new Error(`The release-notes session failed: ${end.failure.message}`);

    if (end.kind !== "completed") throw new Error("The release-notes session was stopped.");

    const reply = view.messages.findLast(
      (message) => message.turn === turn.id && isPart(message, text),
    );

    if (reply === undefined || !isPart(reply, text) || !NOTES.test(reply.state.markdown))
      throw new Error(`Session ${session.id} ended without notes between the changelog markers.`);

    return reply.state.markdown.trim();
  }

  throw new Error("The session watch ended before the run did.");
}

function reviewPrompt(from, to) {
  return `Write the release notes for Nyte v${version}, for a maintainer to review.

The previous stable release is ${from}. Inspect every commit in \`git log --no-merges ${from}..${to}\`
and read each one's diff with \`git show\`. Don't rely on commit titles alone, and don't compare
whole trees. \`origin/main\` and the tags are already fetched. You can read files, list folders
and run read-only git and gh commands; everything else is denied, so don't try to change files.

Write a user-facing changelog with sections for Terminal, Desktop, iOS and SDK, omitting empty
sections and changes that are entirely internal (refactors, tests, CI, build, dependency bumps).
Put bug fixes under "#### Bug fixes" and everything else under "#### Improvements". Credit pull
request authors by GitHub handle when they aren't members of the interfaces-lab organization
(\`gh api orgs/interfaces-lab/members/<login>\` succeeds for members).

Start with "### Highlights": the 2 to 5 changes a user would notice, try or share. Merge related
small changes into one. Skip anything internal or not usable in this release, and leave the section
out rather than pad it. Before writing a highlight, read its pull request with \`gh pr view\` when
there is one, and confirm the behavior in the diff. Name the exact command, flag, setting or place
in the UI. Never guess or embellish, and avoid vague claims like "better" or "faster" without the
specifics. Write each highlight as one bullet: a short Title Case title in bold, then one or two
plain sentences in second person about what you can now do. For example:

- **Reopen Closed Chats**: Press Shift+Cmd+T in the desktop app to bring back the chat you just
  closed. ([#123](https://github.com/interfaces-lab/nyte/pull/123))

Every highlight also appears in the detailed sections. Use "###" for Highlights and each section and
"####" inside them. Never use "#" or "##" headings in the changelog, since each release is filed
under its own "##" heading in CHANGELOG.md.

Put the complete changelog between these markers, each exactly once and outside code fences:

## Changelog

<!-- changelog:start -->
...changelog...
<!-- changelog:end -->

Then add "## Public surface audit" with "### SDK", "### Plugin API" and "### Other risks". Name
each added, removed or changed export, wire operation, schema, hook or setting in the published
@nyte-ai packages, and any other compatibility risk, with its impact. Write "None found." under a
group without changes. This is an audit, not a second changelog.

Reply with only the complete Markdown.`;
}
