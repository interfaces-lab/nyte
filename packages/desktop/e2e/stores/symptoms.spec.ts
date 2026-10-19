import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { messages, sidebar } from "../ui.ts";
import { launchDesktop, member, newBuild, oldBuild, openTerminal, print } from "./builds.ts";
import type { Spawned } from "./builds.ts";
import { installNap } from "./nap-plugin.ts";
import { bashTool, eventually, registeredPids, startChat, world } from "./fixture.ts";
import {
  drivingPid,
  endedRuns,
  integrity,
  jobReports,
  leaseHolder,
  parkerPid,
  presencePid,
} from "./store.ts";

test.setTimeout(240_000);

async function openChat(page: Page, marker: RegExp): Promise<void> {
  await sidebar(page).getByRole("button", { name: marker }).first().click({ timeout: 15_000 });
}

test("chats sync both ways between Nyte.app and a nyte that was working when the app opened", async () => {
  const build = newBuild();
  await using scene = await world("sync", build);
  const session = await startChat(build, scene.home, "SYNC-ZERO first chat");
  const tui = await openTerminal(build, scene.home, [`--session=${session}`]);
  scene.defer(() => tui[Symbol.asyncDispose]());
  await tui.waitFor("SYNC-ZERO", 30_000);
  await tui.type(bashTool("sleep 20; echo slept"));
  await tui.enter();
  await sleep(3_000);

  const desktop = await launchDesktop(build, scene.home);
  scene.defer(() => desktop[Symbol.asyncDispose]());
  await openChat(desktop.page, /SYNC-ZERO/u);
  await expect(messages(desktop.page).getByText("Echo: SYNC-ZERO first chat")).toBeVisible({
    timeout: 5_000,
  });

  await tui.type("SYNC-TUI said this");
  await tui.enter();
  await expect(messages(desktop.page).getByText("SYNC-TUI said this").first()).toBeVisible({
    timeout: 5_000,
  });

  const field = desktop.page.getByRole("combobox", { name: "Message" });
  await field.fill("SYNC-APP said this");
  await field.press("Enter");
  await tui.waitFor("SYNC-APP said this", 5_000);
});

test("a rebuilt nyte starts while an older nyte is working, and the older one keeps working or stops loudly", async () => {
  const older = oldBuild();
  const newer = newBuild();
  await using scene = await world("rebuilt", older);
  const marks = join(scene.parent, "marks.txt");
  const session = await startChat(older, scene.home, "REBUILT first chat");
  const tui = await openTerminal(older, scene.home, [`--session=${session}`]);
  scene.defer(() => tui[Symbol.asyncDispose]());
  await tui.waitFor("REBUILT", 30_000);
  await tui.type(bashTool(`echo start >> ${marks}; sleep 6; echo slept`));
  await tui.enter();
  await eventually(
    "the old build's tool call started",
    async () => (await readFile(marks, "utf8").catch(() => "")).includes("start"),
    30_000,
  );

  const started = await print(newer, scene.home, ["REBUILT hello from the new build"]).exited;

  expect(`${started.stdout}${started.stderr}`).toContain("Echo: REBUILT hello from the new build");
  expect(started.code).toBe(0);

  await tui.waitFor(/Tool said: /u, 30_000);
  await tui.type("OLD-WRITE after the rebuild");
  await tui.enter();

  const outcome = await tui.waitFor(
    /Echo: OLD-WRITE after the rebuild|newer version of Nyte/u,
    30_000,
  );

  test.info().annotations.push({
    type: "older build",
    description: outcome.includes("newer version of Nyte") ? "stopped loudly" : "kept working",
  });

  const ran = (await readFile(marks, "utf8")).split("\n").filter((line) => line === "start");
  expect(ran).toHaveLength(1);
  expect(integrity(scene.home.store)).toBe("ok");
});

test("Nyte.app shows an old chat's transcript at once while a nyte is working", async () => {
  const build = newBuild();
  await using scene = await world("skeleton", build);
  const session = await startChat(build, scene.home, "OLD-CHAT first words");
  const appData = join(scene.parent, "app-data");

  {
    await using first = await launchDesktop(build, scene.home, { appData });
    await openChat(first.page, /OLD-CHAT/u);
    await expect(messages(first.page).getByText("Echo: OLD-CHAT first words")).toBeVisible({
      timeout: 20_000,
    });
  }

  const tui = await openTerminal(build, scene.home, [`--session=${session}`]);
  scene.defer(() => tui[Symbol.asyncDispose]());
  await tui.waitFor("OLD-CHAT", 30_000);
  await tui.type(bashTool("sleep 30; echo slept"));
  await tui.enter();
  await sleep(3_000);

  const launched = performance.now();
  const desktop = await launchDesktop(build, scene.home, { appData });
  scene.defer(() => desktop[Symbol.asyncDispose]());
  await expect(messages(desktop.page).getByText("Echo: OLD-CHAT first words")).toBeVisible({
    timeout: 5_000,
  });
  await expect(desktop.page.getByRole("status", { name: "Loading chat" })).toHaveCount(0);
  test.info().annotations.push({
    type: "first transcript row",
    description: `${String(Math.round(performance.now() - launched))} ms after launch`,
  });
});

test("another live process finishes a run whose driver was killed with SIGKILL mid-tool-call", async () => {
  const build = newBuild();
  await using scene = await world("takeover", build);
  const marks = join(scene.parent, "marks.txt");
  const session = await startChat(build, scene.home, "TAKEOVER first chat");

  const sender = await openTerminal(build, scene.home, [`--session=${session}`]);
  scene.defer(() => sender[Symbol.asyncDispose]());
  const watcher = await openTerminal(build, scene.home, [`--session=${session}`]);
  scene.defer(() => watcher[Symbol.asyncDispose]());
  await sender.waitFor("TAKEOVER", 30_000);
  await watcher.waitFor("TAKEOVER", 30_000);
  const before = new Set([sender.pid, watcher.pid, ...(await registeredPids(scene.home))]);

  await sender.type(bashTool(`echo start >> ${marks}; sleep 8; echo end >> ${marks}`));
  await sender.enter();
  await eventually(
    "the tool call started",
    async () => (await readFile(marks, "utf8").catch(() => "")).includes("start"),
    30_000,
  );
  const driver = await eventually("a driver", () => drivingPid(scene.home.store, session), 10_000);
  const survivor = driver === watcher.pid ? sender : watcher;
  test.info().annotations.push({ type: "driver", description: String(driver) });
  process.kill(driver, "SIGKILL");
  const killed = performance.now();

  await survivor.waitFor(/Tool said: /u, 60_000);
  await eventually(
    "the run ended",
    () => endedRuns(scene.home.store, session).at(-1)?.kind === "completed",
    10_000,
  );
  test.info().annotations.push({
    type: "finished after kill",
    description: `${String(Math.round(performance.now() - killed))} ms`,
  });

  const started = (await readFile(marks, "utf8")).split("\n").filter((line) => line === "start");
  expect(started).toHaveLength(1);
  expect((await registeredPids(scene.home)).filter((pid) => !before.has(pid))).toEqual([]);
  expect(integrity(scene.home.store)).toBe("ok");
});

test("a run that keeps crashing the process driving it is parked after five interruptions and shown", async () => {
  const build = newBuild();
  await using scene = await world("crashloop", build);
  const session = await startChat(build, scene.home, "CRASHLOOP first chat");
  const members: Spawned[] = [];
  scene.defer(() => {
    for (const running of members) running.child.kill("SIGKILL");
  });
  const sender = print(build, scene.home, ["--session", session, "HANG until the driver dies"]);
  members.push(sender);
  const kills: number[] = [];
  let holder: string | null = null;

  for (let round = 0; round < 6; round += 1) {
    const next = await eventually(
      `driver ${String(round + 1)}`,
      () => {
        const current = leaseHolder(scene.home.store, session);

        return current !== null && current !== holder ? current : null;
      },
      60_000,
    ).catch(() => null);

    if (next === null) break;
    holder = next;
    const pid = await eventually("its pid", () => presencePid(scene.home.store, next), 5_000);
    const replacement = member(build, scene.home);
    members.push(replacement);
    await sleep(1_500);

    if (endedRuns(scene.home.store, session).length > 1) break;
    process.kill(pid, "SIGKILL");
    kills.push(pid);
  }

  const ended = await eventually(
    "the run parked",
    () => endedRuns(scene.home.store, session)[1] ?? null,
    60_000,
  );

  test.info().annotations.push({ type: "drivers killed", description: String(kills.length) });

  expect(ended.kind).toBe("failed");
  expect(kills).toHaveLength(5);
  await using reader = await openTerminal(build, scene.home, [`--session=${session}`]);
  await reader.waitFor(/interrupted 5 times/u, 30_000);
  expect(integrity(scene.home.store)).toBe("ok");
});

test("a durable timer started by a nyte that died wakes on time in whichever nyte is alive", async () => {
  const build = newBuild();
  await using scene = await world("timer", build, { audit: true });
  await installNap(scene.home.home);
  const session = await startChat(build, scene.home, "TIMER first chat");
  const survivor = member(build, scene.home);
  scene.defer(() => survivor.child.kill("SIGTERM"));
  await sleep(3_000);
  const sender = print(build, scene.home, ["--session", session, 'TOOL nap {"seconds": 15}']);
  scene.defer(() => sender.child.kill("SIGKILL"));

  const parker = await eventually(
    "the call parked on its timer",
    () => parkerPid(scene.home.store, session),
    20_000,
  );

  test.info().annotations.push({ type: "parked by", description: String(parker) });
  expect(parker).not.toBe(survivor.pid);
  process.kill(parker, "SIGKILL");
  const killed = performance.now();

  await eventually(
    "the run completed",
    () => endedRuns(scene.home.store, session)[1]?.kind === "completed" || null,
    40_000,
  );
  test.info().annotations.push({
    type: "woke after kill",
    description: `${String(Math.round(performance.now() - killed))} ms`,
  });
  expect(survivor.child.exitCode).toBeNull();
  await using reader = await openTerminal(build, scene.home, [`--session=${session}`]);
  await reader.waitFor(/Tool said: napped timer/u, 30_000);
  expect(integrity(scene.home.store)).toBe("ok");
});

test("a background job whose nyte died is reported abandoned by a live nyte and never started again", async () => {
  const build = newBuild();
  await using scene = await world("job", build);
  const marks = join(scene.parent, "job-marks.txt");
  const home = { ...scene.home, env: { ...scene.home.env, NYTE_HARNESS_MARKS: marks } };
  await installNap(home.home);
  const session = await startChat(build, home, "JOB first chat");
  const survivor = member(build, home);
  scene.defer(() => survivor.child.kill("SIGTERM"));
  const owner = await openTerminal(build, home, [`--session=${session}`]);
  scene.defer(() => owner[Symbol.asyncDispose]());
  await owner.waitFor("JOB first chat", 30_000);
  await owner.type('TOOL background {"seconds": 40}');
  await owner.enter();
  await owner.waitFor(/Tool said: started/u, 30_000);
  await eventually(
    "the job ran",
    async () => (await readFile(marks, "utf8").catch(() => "")).includes("started"),
    10_000,
  );
  owner.kill("SIGKILL");
  const killed = performance.now();

  const report = await eventually(
    "the abandoned job's report",
    () =>
      jobReports(home.store, session).find((content) => content.includes("was abandoned")) ?? null,
    45_000,
  );

  test.info().annotations.push({
    type: "reported after kill",
    description: `${String(Math.round(performance.now() - killed))} ms`,
  });

  expect(report).toContain("may still be running");
  expect(
    (await readFile(marks, "utf8")).split("\n").filter((line) => line === "started"),
  ).toHaveLength(1);
  expect(integrity(home.store)).toBe("ok");
});

test("browser tools reach only runs Nyte.app starts, even when Nyte.app takes over a run a nyte started", async () => {
  const build = newBuild();
  await using scene = await world("browser", build);
  const desktop = await launchDesktop(build, scene.home);
  scene.defer(() => desktop[Symbol.asyncDispose]());

  const browsing = (text: string): readonly string[] =>
    scene.model.asked
      .filter((asked) => !asked.title && asked.user.startsWith(text))
      .flatMap((asked) => asked.tools.filter((name) => name.startsWith("browser_")));

  const field = desktop.page.getByRole("combobox", { name: "Message" });
  await desktop.page.getByRole("button", { name: "New Chat ⌘ N" }).click();
  await field.fill("BROWSER from the app");
  await field.press("Enter");
  await expect(messages(desktop.page).getByText("Echo: BROWSER from the app")).toBeVisible({
    timeout: 20_000,
  });
  expect(browsing("BROWSER from the app").length).toBeGreaterThan(0);

  const session = await startChat(build, scene.home, "BROWSER from a nyte");
  expect(browsing("BROWSER from a nyte")).toEqual([]);

  const sender = print(build, scene.home, ["--session", session, "HANG BROWSER orphan"]);
  scene.defer(() => sender.child.kill("SIGKILL"));
  await eventually(
    "the nyte asked the model",
    () => scene.model.asked.some((asked) => asked.user.startsWith("HANG BROWSER orphan")) || null,
    20_000,
  );
  const driver = await eventually("a driver", () => drivingPid(scene.home.store, session), 10_000);
  expect(driver).toBe(sender.pid);
  sender.child.kill("SIGKILL");

  const asks = scene.model.asked.filter((asked) =>
    asked.user.startsWith("HANG BROWSER orphan"),
  ).length;

  await eventually(
    "Nyte.app took the run over",
    () =>
      scene.model.asked.filter((asked) => asked.user.startsWith("HANG BROWSER orphan")).length >
        asks || null,
    45_000,
  );
  expect(presencePid(scene.home.store, leaseHolder(scene.home.store, session) ?? "")).toBe(
    await desktop.hostPid(),
  );
  expect(browsing("HANG BROWSER orphan")).toEqual([]);
});
