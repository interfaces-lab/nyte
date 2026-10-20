import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { press } from "@nyte-ai/app/e2e/scenario-d";
import { HOURS_QUESTION } from "@nyte-ai/app/e2e/scenario-u-fixture";
import { tabTo } from "@nyte-ai/app/e2e/scenario-u-trace";
import { CI_PROMPT, RESTAURANT_PROMPT } from "@nyte-ai/bench";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { launchPackaged, polishAnswers, polishHome, serveScriptedModel } from "./polish-fixture.ts";
import type { PackagedDesktop, PolishHome, ScriptedEndpoint } from "./polish-fixture.ts";
import { composer, messages } from "./ui.ts";

const EXECUTABLE =
  process.env.NYTE_POLISH_EXE ??
  resolve(import.meta.dirname, "../dist/mac-arm64/Nyte.app/Contents/MacOS/Nyte");

const LABEL = process.env.NYTE_POLISH_LABEL === "before" ? "before" : "after";

const JUDGED = LABEL === "after";

const RECONNECT_PROMPT = "Are you still there?";

const LONG_PROMPT = "/long 80";

interface Shown {
  readonly application: ElectronApplication;
  readonly page: Page;
}

interface Run {
  readonly out: string;
  readonly notes: Record<string, unknown>;
  readonly desktop: () => PackagedDesktop;
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function workbench(page: Page): Locator {
  return page.getByRole("complementary", { name: "Workbench" });
}

async function capture(
  run: Run,
  target: Shown,
  surface: string,
  state: string,
  scope?: Locator,
  committed = false,
): Promise<void> {
  const folder = join(run.out, surface);
  await mkdir(folder, { recursive: true });
  const base = join(folder, `${state}-${LABEL}`);

  const { page } = target;

  const aria = await (scope ?? page.locator("body"))
    .ariaSnapshot({ timeout: 5_000 })
    .catch((cause: unknown) => `# not shown: ${String(cause).split("\n")[0] ?? ""}\n`);

  await writeFile(`${base}.aria.yml`, aria);

  if (!(await captureWindow(target.application, `${base}.png`)))
    await page.screenshot({ path: `${base}.png`, caret: "hide" }).catch(() => undefined);

  if (JUDGED && committed && scope !== undefined)
    await expect(scope).toMatchAriaSnapshot({ name: `${surface}-${state}.aria.yml` });
}

const BASELINE_PHASE_MS = 90_000;

async function captureWindow(application: ElectronApplication, path: string): Promise<boolean> {
  const source = await application
    .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getMediaSourceId())
    .catch(() => undefined);

  const id = /^window:(\d+):/u.exec(source ?? "")?.[1];

  if (id === undefined) return false;

  return promisify(execFile)("screencapture", ["-x", "-o", `-l${id}`, path]).then(
    () => exists(path),
    () => false,
  );
}

async function phase(
  run: Run,
  name: string,
  shows: readonly (readonly [surface: string, state: string])[],
  body: () => Promise<void>,
): Promise<void> {
  await test.step(name, async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await (JUDGED
        ? body()
        : Promise.race([
            body(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("phase timed out")), BASELINE_PHASE_MS);
            }),
          ]));
      run.notes[name] = "ok";
    } catch (cause) {
      run.notes[name] = `failed: ${stripVTControlCharacters(String(cause)).split("\n")[0] ?? ""}`;

      if (JUDGED) throw cause;

      for (const [surface, state] of shows)
        if (!(await exists(join(run.out, surface, `${state}-${LABEL}.png`))))
          await capture(run, run.desktop(), surface, state);
    } finally {
      clearTimeout(timer);
      await writeFile(
        join(run.out, `run-${LABEL}.json`),
        `${JSON.stringify(run.notes, null, 2)}\n`,
      );
    }
  });
}

async function arrowTo(item: Locator, limit = 12): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await item.evaluate((element) => element === document.activeElement).catch(() => false))
      return;
    await item.page().keyboard.press("ArrowDown");
  }

  throw new Error(`The arrow keys never reached ${String(item)}.`);
}

const READ_SHIFTS = `new Promise((done) => {
  const entries = [];
  const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
  observer.observe({ type: "layout-shift", buffered: true });
  setTimeout(() => {
    entries.push(...observer.takeRecords());
    observer.disconnect();
    const name = (node) => node === null ? "" : [node.nodeName, node.getAttribute?.("aria-label") ?? "", (node.textContent ?? "").slice(0, 48)].join(" ").trim();
    done(JSON.stringify(entries.map((entry) => ({
      startTime: entry.startTime,
      value: entry.value,
      hadRecentInput: entry.hadRecentInput,
      sources: entry.sources.map((source) => ({
        node: name(source.node),
        previous: source.previousRect.toJSON(),
        current: source.currentRect.toJSON(),
      })),
    }))));
  }, 100);
})`;

const RectSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number(),
  height: Type.Number(),
});

const LayoutShiftsSchema = Type.Array(
  Type.Object({
    startTime: Type.Number(),
    value: Type.Number(),
    hadRecentInput: Type.Boolean(),
    sources: Type.Array(
      Type.Object({ node: Type.String(), previous: RectSchema, current: RectSchema }),
    ),
  }),
);

async function layoutShifts(page: Page, since = 0) {
  const shifts = Value.Parse(
    LayoutShiftsSchema,
    JSON.parse(Value.Parse(Type.String(), await page.evaluate(READ_SHIFTS))),
  ).filter((entry) => !entry.hadRecentInput && entry.startTime >= since);

  return { score: shifts.reduce((total, entry) => total + entry.value, 0), shifts };
}

function busyOverContent(page: Page, text: string, ms: number): Promise<readonly string[]> {
  return page.evaluate(
    ({ text, ms }) =>
      new Promise<string[]>((done) => {
        const frames: string[] = [];
        const end = performance.now() + ms;

        const sample = (): void => {
          const pane = document.querySelector('[role="region"][aria-label="Messages"]');
          const shown = pane?.textContent?.includes(text) === true;

          const busy = pane?.querySelector(
            '[aria-busy="true"], [role="progressbar"], [aria-label^="Loading"]',
          );

          if (shown && busy !== null && busy !== undefined)
            frames.push(
              `${Math.round(performance.now())} ${busy.tagName} ${busy.getAttribute("aria-label") ?? ""} ${(busy.textContent ?? "").slice(0, 40)}`,
            );

          if (performance.now() < end) requestAnimationFrame(sample);
          else done(frames);
        };

        requestAnimationFrame(sample);
      }),
    { text, ms },
  );
}

function movingAnimations(page: Page): Promise<readonly string[]> {
  return page.evaluate(() =>
    document.getAnimations().flatMap((animation) => {
      if (animation.playState !== "running") return [];
      const effect = animation.effect;

      if (!(effect instanceof KeyframeEffect)) return [];

      const moving = effect
        .getKeyframes()
        .flatMap((frame) => Object.keys(frame))
        .filter(
          (key) =>
            !["offset", "easing", "composite", "computedOffset", "opacity", "color"].includes(key),
        );

      const name = animation instanceof CSSAnimation ? animation.animationName : animation.id;

      return moving.length === 0 ? [] : [`${name}: ${[...new Set(moving)].join(", ")}`];
    }),
  );
}

async function sendFromKeyboard(page: Page, text: string): Promise<void> {
  await composer(page).focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function setTheme(desktop: PackagedDesktop, theme: "light" | "dark"): Promise<void> {
  await desktop.application.evaluate(({ nativeTheme }, source) => {
    nativeTheme.themeSource = source;
  }, theme);
  await desktop.page.emulateMedia({ colorScheme: theme });
  await desktop.page.waitForFunction(
    (dark) => matchMedia("(prefers-color-scheme: dark)").matches === dark,
    theme === "dark",
  );
  await desktop.page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

async function newChat(run: Run, page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+n");
  await expect(composer(page)).toHaveText("");
  run.notes["focus after ⌘N"] = await composer(page).evaluate(
    (element) => element === document.activeElement,
  );

  if (JUDGED) await expect(composer(page)).toBeFocused();
}

test.describe.configure({ timeout: 900_000 });

test(`polish evidence (${LABEL}) for scenarios U and D`, async () => {
  const testInfo = test.info();
  const out = process.env.NYTE_POLISH_OUT ?? testInfo.outputPath("polish");
  let open: PackagedDesktop | undefined;

  const run: Run = {
    out,
    notes: { label: LABEL, executable: EXECUTABLE },
    desktop: () => {
      if (open === undefined) throw new Error("No window is open.");

      return open;
    },
  };

  await mkdir(out, { recursive: true });
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-polish-")));
  await using stack = new AsyncDisposableStack();
  stack.defer(() => rm(parent, { recursive: true, force: true }));

  let answer: Parameters<typeof serveScriptedModel>[0] = () => ({ content: [] });
  const model: ScriptedEndpoint = await serveScriptedModel((request) => answer(request));
  stack.defer(() => model.close());
  const home: PolishHome = stack.use(await polishHome(parent, model.origin));
  answer = polishAnswers(home.home, home.places);

  stack.defer(() => open?.close().catch(() => undefined));

  const launch = async (step: string): Promise<PackagedDesktop> => {
    await open?.close();
    open = await launchPackaged({
      executable: EXECUTABLE,
      home: home.home,
      model: model.origin,
      onWindow: (started) => capture(run, started, "window", `loading-${step}`),
    });

    return open;
  };

  let desktop = await launch("fresh");
  let page = desktop.page;

  await phase(
    run,
    "fresh window: empty chat, no layout shift",
    [
      ["window", "empty"],
      ["composer", "empty"],
    ],
    async () => {
      await expect(composer(page)).toBeVisible();
      run.notes["startup CLS (fresh)"] = await layoutShifts(page);
      await capture(run, desktop, "window", "empty");
      await capture(run, desktop, "composer", "empty", page.getByRole("main"), true);

      if (JUDGED) expect(run.notes["startup CLS (fresh)"]).toMatchObject({ score: 0 });
    },
  );

  await phase(run, "macOS: the menu bar and the traffic lights", [], async () => {
    run.notes["application menu"] = await desktop.application.evaluate(({ Menu }) =>
      (Menu.getApplicationMenu()?.items ?? []).map((item) => ({
        menu: item.label,
        items: (item.submenu?.items ?? [])
          .filter((entry) => entry.type !== "separator")
          .map((entry) =>
            [entry.label || entry.role || "", entry.accelerator ?? ""].join(" ").trim(),
          ),
      })),
    );
    run.notes["traffic lights"] = await desktop.application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => window.getWindowButtonPosition()),
    );
  });

  await phase(
    run,
    "settings: connect Anthropic with an API key from the keyboard",
    [
      ["settings-providers", "empty"],
      ["settings-providers", "key-entry"],
      ["settings-providers", "connected"],
    ],
    async () => {
      await page.keyboard.press("ControlOrMeta+,");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await press(page.getByRole("link", { name: "Providers", exact: true }));
      await expect(page.getByRole("heading", { name: "Providers", level: 1 })).toBeVisible();
      await capture(run, desktop, "settings-providers", "empty", page.getByRole("main"));

      const connect = page
        .getByText("Claude models from Anthropic")
        .locator("xpath=ancestor::*[.//button][1]")
        .getByRole("button")
        .first();

      run.notes["Anthropic connect button name"] = await connect.textContent();
      run.notes["connect buttons named alike"] = await page
        .getByRole("button", { name: "Connect Provider", exact: true })
        .count();

      if (JUDGED) await expect(connect).toHaveAccessibleName("Connect Provider Anthropic");
      await tabTo(connect);
      await page.keyboard.press("Enter");
      await arrowTo(page.getByRole("menuitem", { name: /Add API Key/u }));
      await page.keyboard.press("Enter");
      const key = page.getByPlaceholder(/API key/iu);
      await expect(key).toBeVisible();
      run.notes["focus after Add API Key"] = await key.evaluate(
        (element) => element === document.activeElement,
      );

      if (JUDGED) await expect(key).toBeFocused();
      await key.focus();
      await page.keyboard.type("sk-ant-api03-polish");
      await capture(run, desktop, "settings-providers", "key-entry", page.getByRole("main"));
      await page.keyboard.press("Enter");
      await expect(page.getByText("Claude models from Anthropic")).toBeHidden();
      await capture(run, desktop, "settings-providers", "connected", page.getByRole("main"), true);
      run.notes["~/.nyte/auth.json written"] = await access(
        join(home.home, ".nyte", "auth.json"),
      ).then(
        () => true,
        () => false,
      );
    },
  );

  if (!JUDGED && (await page.getByText("Claude models from Anthropic").isVisible())) {
    const row = page
      .getByText("Claude models from Anthropic")
      .locator("xpath=ancestor::*[.//button][1]");

    await row.getByRole("button").first().click();
    await page.getByRole("menuitem", { name: /API Key/u }).click();
    await page.getByPlaceholder(/API key/iu).fill("sk-ant-api03-polish");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Claude models from Anthropic")).toBeHidden();
  }

  await phase(
    run,
    "a connected provider lists its models without a relaunch",
    [["composer", "after-connect"]],
    async () => {
      await newChat(run, page);
      const picker = page.getByRole("button", { name: /^(Scripted|Choose a model)$/u });
      await expect(picker).toBeVisible();
      run.notes["model after connecting"] = await picker.textContent();
      await capture(run, desktop, "composer", "after-connect", page.getByRole("main"));

      if (JUDGED) await expect(picker).toHaveText("Scripted");
    },
  );

  desktop = await launch("relaunch");
  page = desktop.page;

  await phase(
    run,
    "streaming: a held answer, then Esc stops it",
    [
      ["transcript", "streaming"],
      ["composer", "streaming"],
      ["transcript", "reduced-motion"],
    ],
    async () => {
      await newChat(run, page);
      await sendFromKeyboard(page, "/hold");
      await expect(messages(page).getByText(/^Holding/u)).toBeVisible();
      run.notes["focus after submit"] = await composer(page).evaluate(
        (element) => element === document.activeElement,
      );

      if (JUDGED) await expect(composer(page)).toBeFocused();
      await capture(run, desktop, "transcript", "streaming", messages(page));
      await capture(
        run,
        desktop,
        "composer",
        "streaming",
        page.getByRole("form", { name: "Message", exact: true }),
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      run.notes["moving animations under reduced motion"] = await movingAnimations(page);
      await capture(run, desktop, "transcript", "reduced-motion", messages(page));

      if (JUDGED) expect(run.notes["moving animations under reduced motion"]).toEqual([]);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: /^Stop response/u })).toBeHidden();
    },
  );

  await phase(run, "error: the provider refuses", [["transcript", "error"]], async () => {
    await sendFromKeyboard(page, "/error");
    await expect(messages(page).getByText(/refused this request/u)).toBeVisible();
    await capture(run, desktop, "transcript", "error", messages(page), true);
  });

  await phase(
    run,
    "offline: the provider cannot be reached",
    [
      ["transcript", "offline"],
      ["composer", "offline"],
    ],
    async () => {
      model.offline = true;
      await sendFromKeyboard(page, "Is the network up?");
      await expect(
        messages(page)
          .getByRole("alert")
          .or(messages(page).getByText(/connection/iu))
          .first(),
      ).toBeVisible({
        timeout: 60_000,
      });
      await capture(run, desktop, "transcript", "offline", messages(page));
      await capture(
        run,
        desktop,
        "composer",
        "offline",
        page.getByRole("form", { name: "Message", exact: true }),
      );
      model.offline = false;
    },
  );

  await phase(
    run,
    "very long content streams without shifting the transcript",
    [["transcript", "long"]],
    async () => {
      await newChat(run, page);
      const since = await page.evaluate(() => performance.now());
      await sendFromKeyboard(page, LONG_PROMPT);
      await expect(messages(page).getByText(/^Paragraph 80 of 80/u)).toBeVisible({
        timeout: 60_000,
      });
      run.notes["streaming CLS (/long 80)"] = await layoutShifts(page, since);
      await capture(run, desktop, "transcript", "long", messages(page), true);

      if (JUDGED) expect(run.notes["streaming CLS (/long 80)"]).toMatchObject({ score: 0 });
    },
  );

  await phase(
    run,
    "scenario U: skill, places, canvas, question",
    [
      ["tool-rows", "default"],
      ["question", "default"],
      ["canvas", "default"],
      ["question", "dark"],
      ["canvas", "dark"],
      ["transcript", "dark"],
      ["transcript", "streaming-answer"],
    ],
    async () => {
      await newChat(run, page);
      await sendFromKeyboard(page, RESTAURANT_PROMPT);
      const question = page.getByRole("form", { name: HOURS_QUESTION });
      await expect(question).toBeVisible({ timeout: 60_000 });
      await capture(run, desktop, "tool-rows", "default", messages(page));
      await capture(run, desktop, "question", "default", question, true);
      const canvas = messages(page).getByRole("figure", { name: "Random pick nearby" });
      await capture(run, desktop, "canvas", "default", canvas);
      await setTheme(desktop, "dark");
      await capture(run, desktop, "question", "dark", question);
      await capture(run, desktop, "canvas", "dark", canvas);
      await capture(run, desktop, "transcript", "dark", messages(page));
      await setTheme(desktop, "light");
      await tabTo(question.getByRole("radiogroup"));
      await page.keyboard.press("1");
      await page.keyboard.press("Meta+Enter");
      await expect(question).toBeHidden();
      const since = await page.evaluate(() => performance.now());
      await expect(messages(page).getByText(/^I picked/u)).toBeVisible({ timeout: 30_000 });
      await capture(run, desktop, "transcript", "streaming-answer", messages(page));
      await expect(messages(page).getByText(/open until 22:30 tonight/u)).toBeVisible({
        timeout: 60_000,
      });
      const uShifts = await layoutShifts(page, since);
      run.notes["streaming CLS (scenario U answer)"] = uShifts;

      if (JUDGED) expect(uShifts.score).toBeLessThan(0.01);
    },
  );

  await phase(
    run,
    "scenario U: the canvas link opens the workbench browser",
    [["browser", "loaded"]],
    async () => {
      const frame = messages(page)
        .getByRole("figure", { name: "Random pick nearby" })
        .frameLocator("iframe");

      await tabTo(frame.getByRole("link", { name: "Open menu" }), true);
      await page.keyboard.press("Enter");
      const browser = workbench(page).getByRole("region", { name: "Browser", exact: true });
      await expect(browser.getByRole("combobox", { name: "Address" })).toHaveValue(
        `${home.places}/places/luigi`,
      );
      await capture(run, desktop, "browser", "loaded", workbench(page));
      run.notes["focus after opening a canvas link"] = await page.evaluate(
        () => document.activeElement?.tagName ?? null,
      );
    },
  );

  await phase(run, "scenario U: the terminal", [["terminal", "default"]], async () => {
    await tabTo(composer(page));
    await page.keyboard.press("Control+`");
    const input = workbench(page).getByRole("textbox", { name: "Terminal input" });
    await expect(input).toBeFocused();
    await capture(run, desktop, "terminal", "default", workbench(page));
    await page.keyboard.press("Control+`");
  });

  await phase(
    run,
    "narrow window",
    [
      ["window", "narrow"],
      ["composer", "narrow"],
    ],
    async () => {
      await desktop.application.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.setSize(560, 800);
      });
      run.notes["narrow: window size"] = await desktop.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getSize(),
      );
      await page.waitForFunction(() => innerWidth < 700);
      run.notes["narrow: horizontal overflow (px)"] = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      await capture(run, desktop, "window", "narrow");
      await capture(
        run,
        desktop,
        "composer",
        "narrow",
        page.getByRole("form", { name: "Message", exact: true }),
      );

      if (JUDGED) expect(run.notes["narrow: horizontal overflow (px)"]).toBe(0);
      await desktop.application.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.setSize(1280, 800);
      });
    },
  );

  await phase(
    run,
    "scenario D: the repo, CI, the log, the canvas, the editor",
    [
      ["transcript", "scenario-d"],
      ["tool-rows", "long-log"],
      ["canvas", "ci"],
      ["file-editor", "default"],
    ],
    async () => {
      await desktop.application.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      }, home.repo.root);
      await page.keyboard.press("ControlOrMeta+o");
      await newChat(run, page);
      await expect(page.getByRole("button", { name: "repo", exact: true })).toBeVisible();
      await sendFromKeyboard(page, CI_PROMPT);
      await expect(messages(page).getByText(/passes now/u)).toBeVisible({ timeout: 120_000 });
      await capture(run, desktop, "transcript", "scenario-d", messages(page));
      const group = messages(page).getByRole("button", { name: /^Explored SKILL\.md/u });
      await press(group);
      const logs = messages(page).getByRole("button", { name: "ci: Get job logs" });
      await press(logs);
      await expect(
        messages(page)
          .getByRole("region", { name: "Tool output" })
          .filter({ hasText: "step 000001" }),
      ).toBeVisible();
      await capture(run, desktop, "tool-rows", "long-log", messages(page));
      const canvas = messages(page).getByRole("figure", { name: "CI failures" });
      await capture(run, desktop, "canvas", "ci", canvas);
      await press(
        canvas.locator("iframe").contentFrame().getByRole("link", { name: "test/sum.test.js:6" }),
      );
      const editor = workbench(page).getByRole("textbox", { name: "test/sum.test.js" });
      await expect(editor).toBeVisible();
      await expect(workbench(page).getByText("6", { exact: true }).first()).toBeVisible();
      run.notes["focus after a canvas file link"] = await expect(editor)
        .toBeFocused()
        .then(
          () => "editor",
          () => "stayed in the canvas",
        );
      await capture(run, desktop, "file-editor", "default", workbench(page));
    },
  );

  await phase(
    run,
    "scenario D: the Changes panel",
    [
      ["changes", "default"],
      ["changes", "dark"],
    ],
    async () => {
      await press(messages(page).getByRole("button", { name: "Review" }).first());
      const changes = workbench(page).getByRole("region", { name: "Workspace changes" });
      await expect(changes).toBeVisible();
      await capture(run, desktop, "changes", "default", changes);
      await setTheme(desktop, "dark");
      await capture(run, desktop, "changes", "dark", changes);
      await setTheme(desktop, "light");
    },
  );

  await phase(run, "macOS: the window moves before quitting", [], async () => {
    run.notes["bounds before quit"] = await desktop.application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setBounds({ x: 120, y: 90, width: 1100, height: 760 });

      return window?.getBounds();
    });
  });

  desktop = await launch("resume");
  page = desktop.page;

  await phase(
    run,
    "resume: the window, its bounds, no spinner over the transcript",
    [
      ["window", "resume"],
      ["transcript", "resume"],
    ],
    async () => {
      run.notes["bounds after relaunch"] = await desktop.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getBounds(),
      );
      const busy = busyOverContent(page, "passes now", 3_000);
      await expect(messages(page).getByText(/passes now/u)).toBeVisible({ timeout: 30_000 });
      run.notes["busy frames over restored content"] = await busy;
      const resumeShifts = await layoutShifts(page);
      run.notes["startup CLS (resume)"] = resumeShifts;
      await capture(run, desktop, "window", "resume");
      await capture(run, desktop, "transcript", "resume", messages(page), true);

      if (JUDGED) {
        expect(run.notes["busy frames over restored content"]).toEqual([]);
        expect(run.notes["bounds after relaunch"]).toEqual(run.notes["bounds before quit"]);
        expect(resumeShifts.score).toBeLessThan(0.005);
      }
    },
  );

  await phase(
    run,
    "reconnecting: the host process goes away, main restarts it, and the composer sends again",
    [
      ["composer", "reconnecting"],
      ["window", "reconnecting"],
    ],
    async () => {
      const metrics = await desktop.application.evaluate(({ app }) =>
        app.getAppMetrics().map((metric) => ({
          pid: metric.pid,
          type: metric.type,
          name: metric.name ?? "",
          service: metric.serviceName ?? "",
        })),
      );

      run.notes["processes"] = metrics;

      const pid = metrics.find((metric) =>
        `${metric.name} ${metric.service}`.includes("Nyte Host"),
      )?.pid;

      if (pid === undefined) throw new Error("This build runs its host in the main process.");

      const notice = page
        .getByRole("status")
        .or(page.getByRole("alert"))
        .filter({ hasText: /host|connect/iu })
        .first();

      process.kill(pid, "SIGKILL");
      await expect(notice).toBeVisible({ timeout: 20_000 });
      await capture(run, desktop, "composer", "reconnecting", page.getByRole("main"));
      await capture(run, desktop, "window", "reconnecting");
      await expect(notice).toBeHidden({ timeout: 20_000 });
      await page.keyboard.press("ControlOrMeta+n");
      await expect(composer(page)).toBeFocused();
      await page.keyboard.type(RECONNECT_PROMPT);
      await page.keyboard.press("Enter");
      await expect(messages(page).getByText(`Echo: ${RECONNECT_PROMPT}`)).toBeVisible({
        timeout: 20_000,
      });
    },
  );
});
