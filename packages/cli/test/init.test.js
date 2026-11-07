import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { createContext } from "../src/init/context.js";
import { EXIT, planFrom, runSteps } from "../src/init/engine.js";
import { parseInitArgs } from "../src/init/index.js";
import { STEPS, miseTools, nextCommands, ubuntuPackages } from "../src/init/steps.js";
import { checksumFor } from "../src/init/system.js";
import { planLines, question } from "../src/init/ui.js";

function machine(initial = {}) {
  const state = { ...initial };
  const applied = [];

  const step = (id, extra = {}) => ({
    id,
    title: id,
    group: "setup",
    plan: () => `set ${id}`,
    check: async () => (state[id] ? { state: "done", detail: `${id} is set` } : { state: "todo" }),
    apply: async () => {
      applied.push(id);
      state[id] = true;
    },
    ...extra,
  });

  return { state, applied, step };
}

function recordingUI() {
  const events = [];

  const ui = {
    events,
    checking: (work) => work(),
    nothingToDo: () => events.push("nothing"),
    plan: (plan) =>
      events.push(`plan:${plan.map((row) => `${row.step.id}=${row.mark}`).join(",")}`),
    confirm: async () => {
      events.push("confirm");

      return ui.answer ?? true;
    },
    needsPerson: (items) => events.push(`person:${items.map((item) => item.title).join(",")}`),
    cancelled: () => events.push("cancelled"),
    alreadyDone: (step) => events.push(`already:${step.id}`),
    stepStart: (step) => {
      events.push(`start:${step.id}`);

      return { line: () => {}, handOver: () => {} };
    },
    stepDone: (step) => events.push(`done:${step.id}`),
    stepFailed: (step, message) => events.push(`failed:${step.id}:${message}`),
    stepInterrupted: (step) => events.push(`interrupted:${step.id}`),
    ready: () => events.push("ready"),
  };

  return ui;
}

const run = (steps, ui, options = {}) =>
  runSteps({ steps, ctx: {}, ui, yes: true, checkOnly: false, interactive: false, ...options });

test("applies what isn't done, then a second run changes nothing", async () => {
  const m = machine({ a: true });
  const steps = [m.step("a"), m.step("b"), m.step("c")];

  assert.equal(await run(steps, recordingUI()), EXIT.ready);
  assert.deepEqual(m.applied, ["b", "c"]);

  const second = recordingUI();
  assert.equal(await run(steps, second), EXIT.ready);
  assert.deepEqual(m.applied, ["b", "c"]);
  assert.deepEqual(second.events, ["nothing"]);
});

test("a failed run stops there and the next run continues from it", async () => {
  const m = machine();
  let fail = true;

  const steps = [
    m.step("a"),
    m.step("b", {
      apply: async () => {
        if (fail) throw new Error("registry returned 503");
        m.applied.push("b");
        m.state.b = true;
      },
    }),
    m.step("c"),
  ];

  const first = recordingUI();

  assert.equal(await run(steps, first), EXIT.failed);
  assert.deepEqual(m.applied, ["a"]);
  assert.ok(first.events.includes("failed:b:registry returned 503"));

  fail = false;
  const second = recordingUI();
  assert.equal(await run(steps, second), EXIT.ready);
  assert.deepEqual(m.applied, ["a", "b", "c"]);
  assert.ok(second.events.includes("plan:a=done,b=apply,c=apply"));
});

test("an apply that exits cleanly but leaves the check failing is a failure", async () => {
  const m = machine();

  const steps = [
    m.step("a", {
      apply: async () => {},
      check: async () => ({ state: "todo", detail: "node_modules is stale" }),
    }),
  ];

  const ui = recordingUI();

  assert.equal(await run(steps, ui), EXIT.failed);
  assert.ok(ui.events.includes("failed:a:It finished, but node_modules is stale."));
});

test("--check prints the plan, applies nothing, and exits 1 only when there is work", async () => {
  const m = machine({ a: true });
  const steps = [m.step("a"), m.step("b")];

  assert.equal(await run(steps, recordingUI(), { checkOnly: true }), EXIT.failed);
  assert.deepEqual(m.applied, []);

  m.state.b = true;
  assert.equal(await run(steps, recordingUI(), { checkOnly: true }), EXIT.ready);
});

test("a step that needs a person stops a run without a terminal before anything changes", async () => {
  const m = machine();

  const steps = [
    m.step("a"),
    m.step("login", { person: () => "log in to GitHub", manual: () => "gh auth login" }),
  ];

  const ui = recordingUI();

  assert.equal(await run(steps, ui), EXIT.needsPerson);
  assert.deepEqual(m.applied, []);
  assert.ok(ui.events.includes("person:login"));
});

test("without --yes, one question covers the plan and No changes nothing", async () => {
  const m = machine();
  const steps = [m.step("a"), m.step("b")];
  const ui = recordingUI();
  ui.answer = false;

  assert.equal(await run(steps, ui, { yes: false, interactive: true }), EXIT.cancelled);
  assert.deepEqual(m.applied, []);
  assert.equal(ui.events.filter((event) => event === "confirm").length, 1);
});

test("a done step that depends on an applied one is checked again and applied if needed", async () => {
  const m = machine({ deps: true });

  const updateChangesTheLockfile = async () => {
    m.applied.push("update");
    m.state.update = true;
    m.state.deps = false;
  };

  const steps = [
    m.step("update", { apply: updateChangesTheLockfile }),
    m.step("deps", { after: ["update"] }),
  ];

  const ui = recordingUI();

  assert.equal(await run(steps, ui), EXIT.ready);
  assert.ok(ui.events.includes("plan:update=apply,deps=recheck"));
  assert.deepEqual(m.applied, ["update", "deps"]);
});

test("planFrom marks only dependents of applied steps for a recheck", () => {
  const m = machine();
  const steps = [m.step("a"), m.step("b", { after: ["a"] }), m.step("c", { after: ["b"] })];

  const plan = planFrom(steps, [
    { state: "done", detail: "" },
    { state: "done", detail: "" },
    { state: "todo" },
  ]);

  assert.deepEqual(
    plan.map((row) => row.mark),
    ["done", "done", "apply"],
  );
});

test("the plan lists work first, with → for steps a person acts in, then what's done", () => {
  const m = machine({ ok: true });

  const steps = [
    m.step("tool", { group: "install", title: "gh" }),
    m.step("login", { title: "GitHub login", person: () => "log in" }),
    m.step("ok", { title: "Platform" }),
  ];

  const plan = planFrom(steps, [
    { state: "todo" },
    { state: "todo" },
    { state: "done", detail: "macOS 26.1 on arm64" },
  ]);

  assert.deepEqual(planLines(plan, {}), [
    "Install",
    "+ gh             set tool",
    "",
    "Set up",
    "→ GitHub login   set login",
    "",
    "✓ macOS 26.1 on arm64",
  ]);
  assert.equal(
    question(plan, ["click through Apple's installer", "log in to GitHub"]),
    "Apply 2 steps? You'll click through Apple's installer and log in to GitHub.",
  );
});

test("init accepts --yes, --check and --help, and rejects anything else", () => {
  assert.deepEqual(parseInitArgs(["--yes", "--check"]), { yes: true, check: true, help: false });
  assert.throws(() => parseInitArgs(["--force"]), /Unknown option --force/u);
});

test("helpers read checksum files, mise.toml and Ubuntu's package names", () => {
  const hash = "a".repeat(64);
  assert.equal(
    checksumFor(`${hash}  gh_2.1_linux_amd64.tar.gz\n`, "gh_2.1_linux_amd64.tar.gz"),
    hash,
  );
  assert.throws(() => checksumFor(`${hash}  other\n`, "gh"), /doesn't list gh/u);
  assert.deepEqual(
    miseTools('[tools]\nnode = "26"\npnpm = "latest"\n"npm:wrangler" = "4"\n\n[env]\nX = "1"\n'),
    ["node", "pnpm", "npm:wrangler"],
  );
  assert.ok(ubuntuPackages("24.04").includes("libasound2t64"));
  assert.ok(ubuntuPackages("22.04").includes("libasound2"));
});

test("the shell step adds mise to the rc file once", async () => {
  const home = await mkdtemp(join(tmpdir(), "nyte-init-home-"));

  try {
    const ctx = createContext({
      env: { SHELL: "/bin/zsh", PATH: "/usr/bin" },
      cwd: home,
      home,
      platform: "darwin",
      arch: "arm64",
      interactive: false,
    });

    const shell = STEPS.find((step) => step.id === "shell");
    await writeFile(join(home, ".zshrc"), "export EDITOR=vim\n");

    assert.equal((await shell.check(ctx)).state, "todo");
    await shell.apply(ctx, { line: () => {}, handOver: () => {} });
    assert.equal((await shell.check(ctx)).state, "done");

    const rc = await readFile(join(home, ".zshrc"), "utf8");
    assert.match(rc, /^export EDITOR=vim\n/u);
    assert.match(rc, /export PATH="\$HOME\/\.local\/bin:\$PATH"/u);
    assert.match(rc, /mise activate zsh\)"/u);
    assert.deepEqual(nextCommands(ctx), [
      "exec zsh",
      "cd nyte",
      "pnpm dev:tui",
      "pnpm --dir packages/desktop dev",
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
