import { expect, test } from "@playwright/test";
import type { CDPSession, ElectronApplication, Page } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { dev } from "@nyte-ai/core";
import { fakeModels, lastUserText, titleReply } from "@nyte-ai/bench";
import type { Block, Reply, Request } from "@nyte-ai/bench";
import { sdk } from "@nyte-ai/sdk";
import type { SendReceipt } from "@nyte-ai/sdk";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { FIXTURES, prepareHome } from "./baseline.ts";
import { closeWindow, editor } from "./desk.ts";
import { E2E_MODEL } from "./host.ts";
import { launchDesktop } from "./launch.ts";
import { polishModel } from "./polish-fixture.ts";
import { chatRow, messages, openChat, revealChat, setTheme } from "./ui.ts";
import { percentile } from "./work-counts.ts";
import { captureWindow } from "./window-capture.ts";

const OUT = process.env["NYTE_PIERRE_SURFACES"];

const LABEL = process.env["NYTE_PIERRE_LABEL"] ?? "run";

const ONLY = process.env["NYTE_PIERRE_ONLY"];

const PROFILE = process.env["NYTE_PIERRE_PROFILE"] === "1";

const ROOT = "/tmp/pierre";

const XTOOLS = process.env["NYTE_PIERRE_XTOOLS"] ?? join(ROOT, "xtools");

const REPOSITORY = resolve(import.meta.dirname, "../../..");

const SETTLE_MS = 6000;

const CHAT_TURNS = 30;

const CHATS = {
  long: "Pierre long chat",
  forty: "Pierre forty files",
  six: "Pierre six files",
  xtools: "Pierre x tools",
} as const;

const run = promisify(execFile);

const UNITS = new Map([
  ["B", 1 / 1024 / 1024],
  ["KB", 1 / 1024],
  ["MB", 1],
  ["GB", 1024],
]);

interface Edit {
  readonly id: string;
  readonly path: string;
  readonly tool: "edit" | "write";
  readonly oldText: string;
  readonly newText: string;
  readonly excerpt: string;
}

declare global {
  interface Window {
    pierreLongTasks?: { readonly held: number[]; readonly observer: PerformanceObserver };
    pierreFrames?: { readonly times: number[]; recording: boolean };
  }
}

test.skip(OUT === undefined, "A bench: set NYTE_PIERRE_SURFACES to an output folder to run it.");

test.skip(process.platform !== "darwin", "Memory is macOS's phys_footprint.");

async function sources(): Promise<readonly string[]> {
  const base = join(REPOSITORY, "packages/app/src");
  const entries = await readdir(base, { recursive: true, withFileTypes: true });

  const picked = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          /\.tsx?$/u.test(entry.name) &&
          !/\.(test|browser-test|electron\.test)\./u.test(entry.name),
      )
      .map(async (entry) => {
        const path = join(entry.parentPath, entry.name);
        const text = await readFile(path, "utf8");
        const lines = text.split("\n").length;

        return lines >= 120 && lines <= 420 ? [path] : [];
      }),
  );

  return picked.flat().sort();
}

function planEdit(id: string, path: string, text: string, index: number): Edit {
  const lines = text.split("\n");
  const size = 6 + (index % 5) * 4;

  for (
    let start = Math.floor(lines.length * (0.2 + (index % 7) / 10));
    start < lines.length - size;
    start += 1
  ) {
    const block = lines.slice(start, start + size).join("\n");

    if (block.trim().length < 40 || text.indexOf(block) !== text.lastIndexOf(block)) continue;

    const changed = lines
      .slice(start, start + size)
      .map((line, offset) =>
        offset % 2 === 0 && line.trim() !== "" ? `${line} // reviewed ${String(index)}` : line,
      );

    const added = [
      `  const checkpoint${String(index)} = ${String(index * 7)};`,
      `  if (checkpoint${String(index)} < 0) throw new Error("unreachable");`,
    ];

    const next = [...changed.slice(0, 2), ...added, ...changed.slice(2)].join("\n");

    return { id, path, tool: "edit", oldText: block, newText: next, excerpt: next };
  }

  throw new Error(`No unique block in ${path}`);
}

function toolBlock(edit: Edit): Block {
  return {
    type: "toolCall",
    id: edit.id,
    name: edit.tool,
    arguments:
      edit.tool === "write"
        ? { path: edit.path, content: edit.newText }
        : { path: edit.path, edits: [{ oldText: edit.oldText, newText: edit.newText }] },
  };
}

function summary(edit: Edit): string {
  const excerpt = edit.excerpt.split("\n").slice(0, 18).join("\n");

  return `Updated \`${edit.path}\`. The changed region now reads:\n\n\`\`\`ts\n${excerpt}\n\`\`\`\n\nThe checkpoint keeps the branch honest, and the rest of the file is unchanged.`;
}

async function project(
  folder: string,
  files: readonly string[],
): Promise<readonly { readonly path: string; readonly text: string }[]> {
  await mkdir(join(folder, "src"), { recursive: true });

  const copied = await Promise.all(
    files.map(async (source, index) => {
      const path = `src/${String(index).padStart(2, "0")}-${source.split("/").at(-1) ?? "file.ts"}`;
      const text = await readFile(source, "utf8");
      await writeFile(join(folder, path), text);

      return { path, text };
    }),
  );

  const git = (...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=Bench", "-c", "user.email=bench@example.test", ...args], {
      cwd: folder,
      encoding: "utf8",
    });

  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "Initial");

  return copied;
}

function scriptFor(plans: ReadonlyMap<string, readonly Edit[]>): (request: Request) => Reply {
  return (request) => {
    const title = titleReply(request);

    if (title !== null) return { content: [{ type: "text", text: title }] };
    const text = lastUserText(request);
    const edits = plans.get(text);

    if (edits === undefined) return { content: [{ type: "text", text: `Echo: ${text}` }] };

    if (request.context.messages.at(-1)?.role === "toolResult") {
      return {
        content: [
          {
            type: "text",
            text:
              edits.length === 1 && edits[0] !== undefined
                ? summary(edits[0])
                : `Changed ${String(edits.length)} files.`,
          },
        ],
      };
    }

    return { content: edits.map(toolBlock), stopReason: "toolUse" };
  };
}

async function seedHome(parent: string): Promise<void> {
  const prepared = await prepareHome(parent);
  const home = prepared.home;
  const all = await sources();
  const longFiles = await project(join(home, "long"), all.slice(0, CHAT_TURNS));
  const fortyFiles = await project(join(home, "forty"), all.slice(40, 80));
  const sixFiles = await project(join(home, "six"), all.slice(90, 96));
  const writes = all.slice(100, 106);

  const writtenSources = new Map(
    await Promise.all(writes.map(async (path) => [path, await readFile(path, "utf8")] as const)),
  );

  const longPlan = longFiles.map((file, index): Edit => {
    if (index % 6 === 5) {
      const source = writes[Math.floor(index / 6)] ?? all[0] ?? "";
      const text = writtenSources.get(source) ?? "";

      return {
        id: `long-${String(index)}`,
        path: `src/new-${String(index)}.ts`,
        tool: "write",
        oldText: "",
        newText: text,
        excerpt: text,
      };
    }

    return planEdit(`long-${String(index)}`, file.path, file.text, index);
  });

  const fortyPlan = fortyFiles.map((file, index) =>
    planEdit(`forty-${String(index)}`, file.path, file.text, index),
  );

  const sixPlan = sixFiles.map((file, index) =>
    planEdit(`six-${String(index)}`, file.path, file.text, index + 3),
  );

  const plans = new Map<string, readonly Edit[]>([
    ...longPlan.map((edit, index): [string, readonly Edit[]] => [
      `/pierre ${String(index)}`,
      [edit],
    ]),
    ["/pierre forty", fortyPlan],
    ["/pierre six", sixPlan],
  ]);

  await cp(XTOOLS, join(home, "xtools"), { recursive: true });
  dev.off();

  const models = fakeModels({
    id: E2E_MODEL.provider,
    models: [polishModel("http://127.0.0.1")],
    fallback: scriptFor(plans),
  }).models;

  const host = await sdk.open({ models, home, workspace: { kind: "local", path: home } });

  const settle = async (name: string, receipt: SendReceipt): Promise<void> => {
    const outcome = await receipt.settled();

    if (outcome.kind !== "completed") throw new Error(`Seeding ${name} failed: ${outcome.kind}`);
  };

  try {
    const chats: readonly (readonly [string, string, readonly string[]])[] = [
      [CHATS.long, "long", longPlan.map((_, index) => `/pierre ${String(index)}`)],
      [CHATS.forty, "forty", ["/pierre forty"]],
      [CHATS.six, "six", ["/pierre six"]],
      [CHATS.xtools, "xtools", ["Hello from x/tools"]],
    ];

    for (const chat of chats) {
      const added = await host.workspaces.add({ kind: "local", path: join(home, chat[1]) });

      if (added.kind !== "added" && added.kind !== "exists") {
        throw new Error(`The ${chat[1]} workspace was not added: ${added.kind}`);
      }
      const prompts = chat[2];
      const first = prompts[0] ?? "";

      const started = await host.sessions.start({
        name: chat[0],
        content: first,
        workspace: added.workspace,
      });

      await settle(chat[0], started.receipt);

      for (const prompt of prompts.slice(1)) {
        await settle(chat[0], await started.session.send(prompt));
      }
    }
  } finally {
    await host.close();
  }
}

async function freshHome(): Promise<{ readonly parent: string; readonly home: string }> {
  await mkdir(ROOT, { recursive: true });
  const root = await realpath(ROOT);
  const parent = join(root, "run");
  const snapshot = join(root, "seed");

  await rm(parent, { recursive: true, force: true });
  await mkdir(parent, { recursive: true });

  if (
    !(await stat(join(snapshot, "ready")).then(
      () => true,
      () => false,
    ))
  ) {
    await seedHome(parent);
    await rm(snapshot, { recursive: true, force: true });
    await cp(join(parent, "home"), join(snapshot, "home"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    await writeFile(join(snapshot, "ready"), "");
    await rm(parent, { recursive: true, force: true });
    await mkdir(parent, { recursive: true });
  }

  await cp(join(snapshot, "home"), join(parent, "home"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await adoptProjects(join(parent, "home"));

  return { parent, home: join(parent, "home") };
}

async function adoptProjects(home: string): Promise<void> {
  dev.off();

  const models = fakeModels({
    id: E2E_MODEL.provider,
    models: [polishModel("http://127.0.0.1")],
    fallback: () => ({ content: [] }),
  }).models;

  const host = await sdk.open({ models, home, workspace: { kind: "local", path: home } });

  try {
    const listed = await host.sessions.list({});

    for (const [name, folder] of [
      [CHATS.long, "long"],
      [CHATS.forty, "forty"],
      [CHATS.six, "six"],
      [CHATS.xtools, "xtools"],
    ] as const) {
      const added = await host.workspaces.add({ kind: "local", path: join(home, folder) });

      if (added.kind !== "added" && added.kind !== "exists") {
        throw new Error(`The ${folder} workspace was not added: ${added.kind}`);
      }
      const session = listed.items.find((item) => item.name === name);

      if (session === undefined) throw new Error(`${name} isn't seeded`);
      await host.session(session.id).update({ workspace: added.workspace });
    }
  } finally {
    await host.close();
  }
}

async function megabytes(pid: number): Promise<number> {
  const read = await run("/usr/bin/footprint", ["-p", String(pid)]).catch(() => ({ stdout: "" }));
  const found = /phys_footprint:\s+([\d.]+)\s+(B|KB|MB|GB)\b/u.exec(read.stdout);

  return Math.round(Number(found?.[1] ?? 0) * (UNITS.get(found?.[2] ?? "MB") ?? 1));
}

async function memory(application: ElectronApplication, session: CDPSession, pid: number) {
  const raw = await megabytes(pid);

  await session.send("HeapProfiler.collectGarbage");
  await new Promise((done) => setTimeout(done, 1000));
  await session.send("HeapProfiler.collectGarbage");
  await new Promise((done) => setTimeout(done, 2000));
  const heap = await session.send("Runtime.getHeapUsage");
  const afterGc = await megabytes(pid);

  const own = await application.evaluate((electron) =>
    electron.app.getAppMetrics().map((entry) => ({ kind: entry.type, pid: entry.pid })),
  );

  const all = await Promise.all(own.map((entry) => megabytes(entry.pid)));

  return {
    windowMb: raw,
    windowAfterGcMb: afterGc,
    mainHeapMb: Math.round(heap.usedSize / 1024 / 1024),
    appTotalMb: all.reduce((sum, value) => sum + value, 0),
  };
}

async function watchLongTasks(
  page: Page,
): Promise<() => Promise<{ count: number; totalMs: number; maxMs: number }>> {
  await page.evaluate(() => {
    const held: number[] = [];

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) held.push(entry.duration);
    });

    observer.observe({ type: "longtask" });
    window.pierreLongTasks = { held, observer };
  });

  return () =>
    page.evaluate(() => {
      const state = window.pierreLongTasks;

      if (state === undefined) return { count: 0, totalMs: 0, maxMs: 0 };
      state.observer.disconnect();
      const values = state.held;

      return {
        count: values.length,
        totalMs: Math.round(values.reduce((sum, value) => sum + value, 0)),
        maxMs: Math.round(Math.max(0, ...values)),
      };
    });
}

async function startFrames(page: Page): Promise<() => Promise<ReturnType<typeof frameSummary>>> {
  await page.evaluate(() => {
    const times: number[] = [];
    const state = { times, recording: true };

    const tick = (time: number): void => {
      times.push(time);

      if (state.recording) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
    window.pierreFrames = state;
  });

  return async () => {
    const times = await page.evaluate(() => {
      const state = window.pierreFrames;

      if (state === undefined) return [];
      state.recording = false;

      return state.times;
    });

    return frameSummary(times);
  };
}

function frameSummary(times: readonly number[]) {
  const deltas = times.slice(1).map((time, index) => time - (times[index] ?? time));

  return {
    p50: round(percentile(deltas, 0.5)),
    p95: round(percentile(deltas, 0.95)),
    over33: deltas.filter((delta) => delta > 33.4).length,
    frames: deltas.length,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

type Probe = { readonly kind: "diff"; readonly scope: string } | { readonly kind: "tree" };

async function armPaint(page: Page, input: "pointerdown" | "keydown", probe: Probe) {
  return page.evaluateHandle(
    (armed) => ({
      pending: new Promise<{ readonly first: number; readonly highlighted: number }>(
        (done, fail) => {
          const check = () => {
            if (armed.probe.kind === "tree") {
              const count =
                document
                  .querySelector("file-tree-container")
                  ?.shadowRoot?.querySelectorAll('[role="treeitem"][aria-level="3"]').length ?? 0;

              return { rows: count > 2, highlighted: count > 2 };
            }

            const root = document.querySelector(armed.probe.scope) ?? document;

            const hosts = [...root.querySelectorAll("diffs-container")].filter((host) =>
              host.checkVisibility(),
            );

            return {
              rows: hosts.some((host) => host.shadowRoot?.querySelector("[data-line]") != null),
              highlighted: hosts.some(
                (host) =>
                  new Set(
                    [...(host.shadowRoot?.querySelectorAll("[data-line] span[style]") ?? [])].map(
                      (span) => span.getAttribute("style"),
                    ),
                  ).size > 2,
              ),
            };
          };

          window.addEventListener(
            armed.input,
            (event) => {
              const started = event.timeStamp;
              let first = -1;

              const tick = (): void => {
                const seen = check();

                if (seen.rows && first < 0) first = performance.now() - started;

                if (seen.highlighted) done({ first, highlighted: performance.now() - started });
                else if (performance.now() - started > 30_000) fail(new Error("Nothing painted"));
                else requestAnimationFrame(tick);
              };

              requestAnimationFrame(tick);
            },
            { capture: true, once: true },
          );
        },
      ),
    }),
    { input, probe },
  );
}

async function profiled<T>(session: CDPSession, name: string, work: () => Promise<T>): Promise<T> {
  if (!PROFILE) return work();
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 200 });
  await session.send("Profiler.start");
  const result = await work();
  const profile = (await session.send("Profiler.stop")).profile;

  await session.send("Profiler.disable");
  await writeFile(join(OUT ?? ROOT, `${LABEL}-${name}.cpuprofile`), JSON.stringify(profile));

  return result;
}

async function wheelThrough(page: Page, scroller: string, step: number, max: number) {
  const frames = await startFrames(page);
  let steps = 0;

  for (; steps < max; steps += 1) {
    await page.mouse.wheel(0, step);
    await page.waitForTimeout(16);

    if (steps % 10 === 9) {
      const end = await page.evaluate((selector) => {
        const element = document.querySelector(selector);

        return (
          element === null || element.scrollTop + element.clientHeight >= element.scrollHeight - 2
        );
      }, scroller);

      if (end) break;
    }
  }

  return { ...(await frames()), wheels: steps };
}

async function markScroller(page: Page, region: string, name: string): Promise<void> {
  await page.evaluate(
    (input) => {
      const scope = document.querySelector(input.region);

      const candidates = [scope, ...(scope?.querySelectorAll("*") ?? [])].filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          element.scrollHeight > element.clientHeight + 40 &&
          ["auto", "scroll"].includes(getComputedStyle(element).overflowY),
      );

      const largest = candidates.sort((left, right) => right.clientHeight - left.clientHeight)[0];

      if (largest === undefined) throw new Error(`No scroller in ${input.region}`);
      largest.dataset.pierreScroller = input.name;
    },
    { region, name },
  );
}

async function capture(
  desktop: { readonly application: ElectronApplication; readonly page: Page },
  session: CDPSession,
  name: string,
  region: string,
  target: () => Promise<void>,
): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    await setTheme(desktop, theme);
    await target();
    await desktop.page.waitForTimeout(1200);
    const box = await desktop.page.locator(region).first().boundingBox();

    if (box === null) throw new Error(`${region} has no box to capture`);

    const shot = await session.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
    });

    await writeFile(
      join(OUT ?? ROOT, `${LABEL}-${name}-${theme}.png`),
      Buffer.from(shot.data, "base64"),
    );
  }

  await setTheme(desktop, "light");
}

async function background(page: Page, application: ElectronApplication) {
  await (
    await application.browserWindow(page)
  ).evaluate((window) => window.setBounds({ x: 40, y: 40, width: 1440, height: 900 }));
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });

  const pid = await (
    await application.browserWindow(page)
  ).evaluate((window) => window.webContents.getOSProcessId());

  return { session, pid };
}

async function setPreference(page: Page, field: string, value: string): Promise<void> {
  await page.evaluate(
    (input) => {
      const key = "nyte:appearance:v1";
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(
        key,
        JSON.stringify(Object.assign({}, stored, { [input.field]: input.value })),
      );
      window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
    },
    { field, value },
  );
}

async function report(name: string, body: object): Promise<void> {
  await mkdir(OUT ?? ROOT, { recursive: true });
  await writeFile(join(OUT ?? ROOT, `${LABEL}-${name}.json`), JSON.stringify(body, null, 2));
  process.stdout.write(`pierre-surface ${name}: ${JSON.stringify(body)}\n`);
}

function scenario(name: string): boolean {
  return ONLY === undefined || ONLY.split(",").includes(name);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await mkdir(OUT ?? ROOT, { recursive: true });
});

// oxlint-disable-next-line eslint/no-empty-pattern -- Playwright reads a test's fixtures from this pattern, and the bench launches its own app
test("chat: 30 tool-call diffs and code blocks, top to bottom", async ({}, testInfo) => {
  test.skip(!scenario("chat"));
  test.setTimeout(900_000);
  const prepared = await freshHome();

  const launched = await launchDesktop({
    home: prepared.home,
    parentDirectory: prepared.parent,
    background: true,
  });

  const page = launched.page;
  const problems = collectErrors(page);
  const workers: string[] = [];

  page.on("worker", (worker) => workers.push(worker.url()));

  try {
    const window = await background(page, launched.application);
    await setPreference(page, "toolCalls", "detailed");
    await openChat(page, FIXTURES.beta);
    await page.waitForTimeout(SETTLE_MS);
    const empty = await memory(launched.application, window.session, window.pid);
    await revealChat(page, CHATS.long);
    const long = await watchLongTasks(page);
    const armed = await armPaint(page, "pointerdown", { kind: "diff", scope: "body" });

    const paint = await profiled(window.session, "chat-open", async () => {
      await chatRow(page, CHATS.long).click();

      return armed.evaluate((state) => state.pending);
    });

    const openLong = await long();
    await page.waitForTimeout(SETTLE_MS);
    const opened = await memory(launched.application, window.session, window.pid);
    const scroller = '[data-pierre-scroller="chat"]';

    await messages(page).evaluate((element) => element.setAttribute("data-pierre-messages", ""));
    await markScroller(page, "[data-pierre-messages]", "chat");
    const box = await messages(page).boundingBox();

    if (box === null) throw new Error("No transcript");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    for (let round = 0; round < 12; round += 1) {
      await page.evaluate(
        (selector) => document.querySelector(selector)?.scrollTo({ top: 0 }),
        scroller,
      );
      await page.waitForTimeout(600);
    }

    const scrollLong = await watchLongTasks(page);

    const scroll = await profiled(window.session, "chat-scroll", () =>
      wheelThrough(page, scroller, 120, 1500),
    );

    const scrollTasks = await scrollLong();
    const diffs = await page.evaluate(() => document.querySelectorAll("diffs-container").length);
    await page.waitForTimeout(SETTLE_MS);
    const scrolled = await memory(launched.application, window.session, window.pid);

    await page.evaluate(
      (selector) => document.querySelector(selector)?.scrollTo({ top: 0 }),
      scroller,
    );
    await capture(launched, window.session, "chat", "[data-pierre-messages]", async () => {
      await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        element?.scrollTo({ top: element.scrollHeight * 0.4 });
      }, scroller);
    });

    await report("chat", {
      paintMs: { rows: Math.round(paint.first), highlighted: Math.round(paint.highlighted) },
      openLongTasks: openLong,
      scroll,
      scrollLongTasks: scrollTasks,
      memory: { empty, opened, scrolled },
      workersStarted: workers.length,
      diffsMountedAtEnd: diffs,
    });
    expect(problems.pageErrors).toEqual([]);
  } catch (cause) {
    await captureWindow(launched, testInfo.outputPath("chat-failed.png")).catch(() => undefined);
    throw cause;
  } finally {
    await launched.close();
  }
});

for (const review of [
  { name: "changes40", chat: CHATS.forty, files: 40 },
  { name: "review6", chat: CHATS.six, files: 6 },
] as const) {
  // oxlint-disable-next-line eslint/no-empty-pattern -- Playwright reads a test's fixtures from this pattern, and the bench launches its own app
  test(`changes: ${review.name}`, async ({}, testInfo) => {
    test.skip(!scenario(review.name));
    test.setTimeout(900_000);
    const prepared = await freshHome();

    const launched = await launchDesktop({
      home: prepared.home,
      parentDirectory: prepared.parent,
      background: true,
    });

    const page = launched.page;
    const problems = collectErrors(page);
    const workers: string[] = [];

    page.on("worker", (worker) => workers.push(worker.url()));

    try {
      const window = await background(page, launched.application);
      await openChat(page, review.chat);
      const card = page.getByRole("region", { name: `${String(review.files)} files changed` });
      await expect(card).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(SETTLE_MS);
      const empty = await memory(launched.application, window.session, window.pid);
      const long = await watchLongTasks(page);

      const armed = await armPaint(page, "pointerdown", {
        kind: "diff",
        scope: "[data-changes-stack]",
      });

      const paint = await profiled(window.session, `${review.name}-open`, async () => {
        await card.getByRole("button", { name: "Review", exact: true }).click();

        return armed.evaluate((state) => state.pending);
      });

      const openTasks = await long();
      await page.waitForTimeout(SETTLE_MS);
      const opened = await memory(launched.application, window.session, window.pid);
      const scroller = "[data-changes-stack]";

      const rendered = await page.evaluate(() => {
        const host = document.querySelector("[data-changes-stack] diffs-container");
        const shadow = host?.shadowRoot;

        const height = (element: Element | null | undefined): number =>
          element === null || element === undefined ? -1 : element.getBoundingClientRect().height;

        return {
          header: height(document.querySelector("[data-changes-stack] [data-change-path]")),
          separator: height(shadow?.querySelector('[data-separator="line-info"]')),
          line: height(shadow?.querySelector("[data-line]")),
        };
      });

      const box = await page.locator(scroller).boundingBox();

      if (box === null) throw new Error("No stack");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const scrollLong = await watchLongTasks(page);

      const scroll = await profiled(window.session, `${review.name}-scroll`, () =>
        wheelThrough(page, scroller, 120, 2000),
      );

      const scrollTasks = await scrollLong();
      await page.waitForTimeout(SETTLE_MS);
      const scrolled = await memory(launched.application, window.session, window.pid);

      await capture(launched, window.session, review.name, scroller, async () => {
        await page.evaluate(
          (selector) => document.querySelector(selector)?.scrollTo({ top: 0 }),
          scroller,
        );
      });

      await report(review.name, {
        paintMs: { rows: Math.round(paint.first), highlighted: Math.round(paint.highlighted) },
        openLongTasks: openTasks,
        scroll,
        scrollLongTasks: scrollTasks,
        memory: { empty, opened, scrolled },
        workersStarted: workers.length,
        rendered,
      });
      expect(problems.pageErrors).toEqual([]);
    } catch (cause) {
      await captureWindow(launched, testInfo.outputPath(`${review.name}-failed.png`)).catch(
        () => undefined,
      );
      throw cause;
    } finally {
      await launched.close();
    }
  });
}

// oxlint-disable-next-line eslint/no-empty-pattern -- Playwright reads a test's fixtures from this pattern, and the bench launches its own app
test("explorer: golang.org/x/tools", async ({}, testInfo) => {
  test.skip(!scenario("explorer"));
  test.setTimeout(900_000);
  const prepared = await freshHome();

  const launched = await launchDesktop({
    home: prepared.home,
    parentDirectory: prepared.parent,
    background: true,
  });

  const application = launched.application;

  try {
    await openChat(launched.page, CHATS.xtools);
    await launched.page
      .getByRole("group", { name: "Apps" })
      .getByRole("button", { name: "Code", exact: true })
      .click();
    await launched.page.waitForTimeout(2000);
    const code = application.windows().at(-1) ?? launched.page;
    const problems = collectErrors(code);
    await code.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });

    if (code !== launched.page) await closeWindow(application, launched.page);
    const window = await background(code, application);
    const files = editor(code);
    const toggle = files.getByRole("button", { name: "Editor Sidebar", pressed: false });

    await expect(toggle.or(files.getByRole("treeitem").first())).toBeVisible();

    if (await toggle.isVisible()) await toggle.click();
    await files.getByRole("treeitem", { name: "cmd", exact: true }).first().waitFor();
    await code.waitForTimeout(SETTLE_MS);
    const empty = await memory(application, window.session, window.pid);
    const long = await watchLongTasks(code);
    const filter = files.getByRole("textbox", { name: "Filter files" });
    await filter.click();
    const armed = await armPaint(code, "keydown", { kind: "tree" });
    await filter.pressSequentially(".go");
    const paint = await armed.evaluate((state) => state.pending);
    const openTasks = await long();
    await code.waitForTimeout(SETTLE_MS);
    const opened = await memory(application, window.session, window.pid);

    const rows = await code.evaluate(
      () =>
        document
          .querySelector("file-tree-container")
          ?.shadowRoot?.querySelectorAll('[role="treeitem"]').length ?? 0,
    );

    await code.evaluate(() => {
      const host = document.querySelector("file-tree-container");

      const scroller = [...(host?.shadowRoot?.querySelectorAll("*") ?? [])].find(
        (element) =>
          element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 40,
      );

      if (scroller instanceof HTMLElement) {
        scroller.dataset.pierreScroller = "tree";
        host?.setAttribute("data-pierre-tree-height", String(scroller.scrollHeight));
      }
    });
    const tree = await code.locator("file-tree-container").boundingBox();

    if (tree === null) throw new Error("No tree");
    await code.mouse.move(tree.x + tree.width / 2, tree.y + tree.height / 2);
    const scrollLong = await watchLongTasks(code);
    const frames = await startFrames(code);

    for (let step = 0; step < 300; step += 1) {
      await code.mouse.wheel(0, 160);
      await code.waitForTimeout(16);
    }

    const scroll = await frames();
    const scrollTasks = await scrollLong();
    await code.waitForTimeout(SETTLE_MS);
    const scrolled = await memory(application, window.session, window.pid);

    await capture(
      { application, page: code },
      window.session,
      "explorer",
      "file-tree-container",
      async () => {
        await code.mouse.wheel(0, -100_000);
      },
    );

    await report("explorer", {
      paintMs: { rows: Math.round(paint.first), highlighted: Math.round(paint.highlighted) },
      openLongTasks: openTasks,
      scroll,
      scrollLongTasks: scrollTasks,
      memory: { empty, opened, scrolled },
      treeRowsInDom: rows,
    });
    expect(problems.pageErrors).toEqual([]);
  } catch (cause) {
    for (const page of application.windows()) {
      process.stdout.write(
        `debug window:\n${(
          await page
            .locator("body")
            .ariaSnapshot()
            .catch(() => "")
        ).slice(0, 5000)}\n`,
      );
    }

    for (const [index, page] of application.windows().entries()) {
      await captureWindow(
        { application, page },
        testInfo.outputPath(`explorer-failed-${String(index)}.png`),
      ).catch(() => undefined);
    }
    throw cause;
  } finally {
    await launched.close();
  }
});
