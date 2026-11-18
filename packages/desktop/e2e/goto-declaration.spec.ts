import { expect, test as base } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { FIXTURES, prepareHome } from "./baseline.ts";
import { caretStatus, editor, goTo } from "./desk.ts";
import { launchDesktop } from "./launch.ts";
import { openChat, setTheme } from "./ui.ts";
import { captureWindow } from "./window-capture.ts";

/** Go repositories the chapter navigates, cloned beforehand: `git clone https://github.com/spf13/cobra /tmp/cobra`, and golang.org/x/tools into `/tmp/xtools`. */
const REPOSITORIES = { cobra: "/tmp/cobra", xtools: "/tmp/xtools" } as const;

const SAMPLES = 25;

interface Code {
  readonly application: ElectronApplication;
  readonly nyte: Page;
  readonly page: Page;
  readonly home: string;
  capture(name: string): Promise<void>;
}

/**
 * A launch over a seeded home holding cobra and x/tools, with gopls on the login shell's PATH and the
 * user's module cache, and a Code window open on it.
 */
const test = base.extend<{ readonly code: Code }>({
  code: async ({}, use, testInfo) => {
    await using stack = new AsyncDisposableStack();
    const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-goto-")));
    stack.defer(() => rm(parent, { recursive: true, force: true }));
    const prepared = await prepareHome(parent);
    const home = prepared.home;
    const gopls = execFileSync("mise", ["which", "gopls"], { encoding: "utf8" }).trim();
    const go = execFileSync("mise", ["which", "go"], { encoding: "utf8" }).trim();
    const modules = execFileSync(go, ["env", "GOMODCACHE"], { encoding: "utf8" }).trim();

    await writeFile(
      join(home, ".zshenv"),
      [
        `export PATH="${dirname(gopls)}:${dirname(go)}:$PATH"`,
        `export GOMODCACHE="${modules}"`,
        "export GOPROXY=off GOTOOLCHAIN=local",
        "",
      ].join("\n"),
    );

    for (const [name, source] of Object.entries(REPOSITORIES))
      await cp(source, join(home, name), {
        recursive: true,
        filter: (path) => !path.includes("/.git"),
      });

    const launched = await launchDesktop({ home, parentDirectory: parent });
    stack.defer(() => launched.close());
    const problems = [collectErrors(launched.page)];

    await openChat(launched.page, FIXTURES.beta);
    const opening = launched.application.waitForEvent("window");
    await launched.page
      .getByRole("group", { name: "Apps" })
      .getByRole("button", { name: "Code", exact: true })
      .click();
    const page = await opening;
    problems.push(collectErrors(page));
    await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });
    await (
      await launched.application.browserWindow(page)
    ).evaluate((window) => {
      window.setBounds({ x: 40, y: 40, width: 1400, height: 900 });
      window.focus();
    });

    await use({
      application: launched.application,
      nyte: launched.page,
      page,
      home,
      capture: async (name) => {
        const path = testInfo.outputPath(`${name}.png`);

        await frames(page);
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.timeline instanceof DocumentTimeline &&
                  animation.playState === "running" &&
                  Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
              )
              .map((animation) => animation.finished.catch(() => undefined)),
          ),
        );
        const captured = await captureWindow(
          { application: launched.application, page },
          path,
        ).catch(async () => {
          testInfo.annotations.push({
            type: "capture",
            description: `${name}: page only, the window server refused`,
          });
          await page.screenshot({ path });

          return { path, contentType: "image/png" };
        });

        await testInfo.attach(name, captured);
      },
    });

    if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
      await page
        .screenshot({ path: testInfo.outputPath("failed-code.png") })
        .catch(() => undefined);
      await testInfo.attach("failed-code-aria", {
        body: await page
          .locator("body")
          .ariaSnapshot()
          .catch(() => ""),
        contentType: "text/plain",
      });
    }

    for (const found of problems) {
      expect(found.pageErrors, "uncaught page errors").toEqual([]);
      expect(
        found.consoleErrors.filter((text) => !text.startsWith("DEV:")),
        "console errors",
      ).toEqual([]);
    }
  },
});

for (const theme of ["dark", "light"] as const)
  test(`Go to Declaration and back, ${theme}`, async ({ code }, testInfo) => {
    test.setTimeout(420_000);
    const page = code.page;
    const command = await source(code.home, "cobra/command.go");

    await setTheme({ application: code.application, page: code.nyte }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-display-mode", theme);
    await editor(page).waitFor();
    await editor(page)
      .click({ position: { x: 400, y: 300 } })
      .catch(() => undefined);
    const text = await openPath(page, "cobra/command.go");

    await test.step("⌘B on a call lands on its declaration in another file", async () => {
      const at = find(command, "return commandFound, a, legacyArgs(", "legacyArgs");

      await goTo(page, at.line, at.column);
      await page.keyboard.press("Meta+B");
      await expect(activeTab(page)).toHaveAccessibleName(/^cobra\/args\.go/u);
      await expect(caretStatus(page)).toHaveText("Ln 28, Col 6", { timeout: 60_000 });
      await code.capture(`01-${theme}-landed-in-args`);
    });

    await test.step("⌘[ goes back to the call, caret and scroll restored, and ⌘] forward again", async () => {
      const at = find(command, "return commandFound, a, legacyArgs(", "legacyArgs");

      await page.keyboard.press("Meta+BracketLeft");
      await expect(activeTab(page)).toHaveAccessibleName(/^cobra\/command\.go/u);
      await expect(caretStatus(page)).toHaveText(`Ln ${String(at.line)}, Col ${String(at.column)}`);
      await page.keyboard.press("Meta+BracketRight");
      await expect(activeTab(page)).toHaveAccessibleName(/^cobra\/args\.go/u);
      await expect(caretStatus(page)).toHaveText("Ln 28, Col 6");
      await page.keyboard.press("Meta+BracketLeft");
      await expect(caretStatus(page)).toHaveText(`Ln ${String(at.line)}, Col ${String(at.column)}`);
      await code.capture(`02-${theme}-back`);
    });

    await test.step("⌘-hover underlines the reference; ⌘-click goes to it in the same file", async () => {
      const at = find(command, "argsWOflags := stripFlags(innerArgs, c)", "stripFlags");
      const token = tokenAt(text, at.line, "stripFlags");

      await goTo(page, at.line, 1);
      await page.keyboard.down("Meta");
      await token.hover();
      await expect(text.locator("[data-declaration-link]")).toHaveText("stripFlags");
      await code.capture(`03-${theme}-hover-link`);
      await token.click({ modifiers: ["Meta"] });
      await page.keyboard.up("Meta");
      await expect(text.locator("[data-declaration-link]")).toHaveCount(0);
      const declared = find(command, "func stripFlags(", "stripFlags");

      await expect(caretStatus(page)).toHaveText(
        `Ln ${String(declared.line)}, Col ${String(declared.column)}`,
      );
      await page.keyboard.press("Meta+BracketLeft");
      await expect(caretStatus(page)).toHaveText(`Ln ${String(at.line)}, Col 1`);
    });

    await test.step("⌘B on a declaration lists its usages", async () => {
      const declared = find(command, "func stripFlags(", "stripFlags");

      await goTo(page, declared.line, declared.column);
      await page.keyboard.press("Meta+B");
      const chooser = page.getByRole("menu");

      await expect(chooser.getByText("Usages of stripFlags")).toBeVisible();
      await expect(chooser.getByRole("menuitem")).toHaveCount(
        usages(command, "stripFlags(") +
          usages(await source(code.home, "cobra/command_test.go"), "stripFlags("),
      );
      await code.capture(`04-${theme}-usages`);
      await page.keyboard.press("Escape");
      await expect(chooser).toBeHidden();
    });

    await test.step("an import path offers each of the package's files", async () => {
      const at = find(command, 'flag "github.com/spf13/pflag"', "github");

      await goTo(page, at.line, at.column);
      await page.keyboard.press("Meta+B");
      const chooser = page.getByRole("menu");

      await expect(chooser.getByText("Choose Declaration")).toBeVisible({ timeout: 30_000 });
      await code.capture(`05-${theme}-choose-declaration`);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(activeTab(page)).toHaveAccessibleName(/pflag/u);
      await expect(activePanel(page).getByText("Read-only library file")).toBeVisible();
      await page.keyboard.press("Meta+BracketLeft");
      await expect(activeTab(page)).toHaveAccessibleName(/^cobra\/command\.go/u);
    });

    await test.step("Quick Definition peeks without moving, and Edit Source goes there", async () => {
      const at = find(
        command,
        "if EnablePrefixMatching && cmd.hasNameOrAliasPrefix(next)",
        "EnablePrefixMatching",
      );

      await goTo(page, at.line, at.column);
      await page.keyboard.press("Alt+Space");
      const peek = page.getByRole("dialog", { name: "Definition of EnablePrefixMatching" });

      await expect(peek).toBeVisible();
      await expect(peek).toContainText("cobra/cobra.go:55");
      await expect(peek).toContainText("var EnablePrefixMatching = defaultPrefixMatching");
      await expect(caretStatus(page)).toHaveText(`Ln ${String(at.line)}, Col ${String(at.column)}`);
      await code.capture(`06-${theme}-peek`);
      await page.keyboard.press("Enter");
      await expect(activeTab(page)).toHaveAccessibleName(/^cobra\/cobra\.go/u);
      await expect(caretStatus(page)).toHaveText("Ln 55, Col 5");
      await page.keyboard.press("Meta+BracketLeft");
      await expect(activeTab(page)).toHaveAccessibleName(/^cobra\/command\.go/u);
    });

    await test.step("the standard library opens read-only and takes no typing", async () => {
      const at = find(command, 'case strings.HasPrefix(s, "--") && !strings.Contains', "HasPrefix");

      await goTo(page, at.line, at.column);
      await page.keyboard.press("Meta+B");
      await expect(activeTab(page)).toHaveAccessibleName(/strings\.go$/u);
      const library = activeText(page);

      await expect(activePanel(page).getByText("Read-only library file")).toBeVisible();
      const before = await library.textContent();

      await page.keyboard.type("x");
      await expect(library).toHaveText(before ?? "");
      await code.capture(`07-${theme}-stdlib-read-only`);
      await page.keyboard.press("Meta+BracketLeft");
      await expect(activeTab(page)).toHaveAccessibleName(/^cobra\/command\.go/u);
    });

    await test.step("Go to Type Declaration from a receiver", async () => {
      const at = find(command, "func (c *Command) Find(args []string)", "c");

      await goTo(page, at.line, at.column);
      await page.keyboard.press("Meta+Shift+B");
      const declared = find(command, "type Command struct {", "Command");

      await expect(caretStatus(page)).toHaveText(
        `Ln ${String(declared.line)}, Col ${String(declared.column)}`,
      );
      await page.keyboard.press("Meta+BracketLeft");
    });

    await test.step("a keyword has nowhere to go, and says so where it stands", async () => {
      const at = find(command, "func hasNoOptDefVal(", "func");

      await goTo(page, at.line, at.column);
      await page.keyboard.press("Meta+B");
      await expect(
        page.getByRole("alert").getByText("Cannot find declaration to go to"),
      ).toBeVisible();
      await code.capture(`08-${theme}-nowhere`);
      await page.keyboard.press("Escape");
    });

    await test.step("an unsaved edit moves the landing with it", async () => {
      const at = find(command, "argsWOflags := stripFlags(innerArgs, c)", "stripFlags");
      const declared = find(command, "func stripFlags(", "stripFlags");

      await goTo(page, 1, 1);
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await goTo(page, at.line + 2, at.column);
      await page.keyboard.press("Meta+B");
      await expect(caretStatus(page)).toHaveText(
        `Ln ${String(declared.line + 2)}, Col ${String(declared.column)}`,
      );
      await page.keyboard.press("Meta+Z");
      await page.keyboard.press("Meta+Z");
    });

    if (theme !== "dark") return;

    await test.step("time to declaration in cobra and x/tools", async () => {
      const cobra = await timeJumps(page, command, [
        ["return commandFound, a, legacyArgs(", "legacyArgs"],
        ["argsWOflags := stripFlags(innerArgs, c)", "stripFlags"],
        ['case strings.HasPrefix(s, "--") && !strings.Contains', "HasPrefix"],
      ]);

      await openPath(page, "xtools/go/packages/packages.go");
      const packages = await source(code.home, "xtools/go/packages/packages.go");
      const warm = find(packages, "gocommand.WriteOverlays", "WriteOverlays");

      await goTo(page, warm.line, warm.column);
      await expect(async () => {
        await page.keyboard.press("Escape");
        await page.keyboard.press("Meta+B");
        await expect(activeTab(page)).toHaveAccessibleName(/invoke\.go$/u, { timeout: 3_000 });
      }).toPass({ timeout: 120_000 });
      await page.keyboard.press("Meta+BracketLeft");
      await expect(caretStatus(page)).toHaveText(
        `Ln ${String(warm.line)}, Col ${String(warm.column)}`,
      );

      const tools = await timeJumps(page, packages, [
        ["gocommand.WriteOverlays(cfg.Overlay)", "WriteOverlays"],
        ["var runner gocommand.Runner", "Runner"],
        ["if !typesinternal.SetUsesCgo(tc)", "SetUsesCgo"],
      ]);

      const report = { cobra: summary(cobra), xtools: summary(tools) };

      const latency = testInfo.outputPath("latency.json");

      await writeFile(
        latency,
        JSON.stringify({ ...report, samples: { cobra, xtools: tools } }, null, 2),
      );
      await testInfo.attach("latency", { path: latency, contentType: "application/json" });
      expect(report.cobra.p95, "cobra p95 time to declaration").toBeLessThanOrEqual(100);
      expect(report.xtools.p95, "x/tools p95 time to declaration").toBeLessThanOrEqual(100);
    });
  });

/** Times ⌘B from the key to the frame that shows the caret at the declaration, then ⌘[ back, which restores the caret, after one warm-up each. */
async function timeJumps(
  page: Page,
  text: string,
  targets: readonly (readonly [string, string])[],
): Promise<readonly number[]> {
  const times: number[] = [];

  for (const target of targets) {
    const at = find(text, target[0], target[1]);
    const origin = `Ln ${String(at.line)}, Col ${String(at.column)}`;

    await goTo(page, at.line, at.column);

    for (let round = 0; round <= SAMPLES; round += 1) {
      await page.evaluate((from) => {
        const status = (): string =>
          [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) button')]
            .filter((button) => button.checkVisibility())
            .map((button) => button.textContent)
            .find((label) => /^Ln \d+, Col \d+$/u.test(label)) ?? "";

        Object.assign(window, {
          gotoLanded: new Promise<number>((resolve, reject) => {
            window.addEventListener(
              "keydown",
              (event) => {
                const started = event.timeStamp;
                const tick = (): void => {
                  const shown = status();

                  if (shown !== from && shown !== "") resolve(performance.now() - started);
                  else if (performance.now() - started > 5_000)
                    reject(new Error(`⌘B from ${from} landed nowhere`));
                  else requestAnimationFrame(tick);
                };

                requestAnimationFrame(tick);
              },
              { capture: true, once: true },
            );
          }),
        });
      }, origin);
      await page.keyboard.press("Meta+B");
      const ms = await page.evaluate(() => Reflect.get(window, "gotoLanded"));

      if (round > 0) times.push(Math.round(ms));
      await page.keyboard.press("Meta+BracketLeft");
      await expect(caretStatus(page)).toHaveText(origin);
    }
  }

  return times;
}

function summary(times: readonly number[]) {
  const sorted = times.toSorted((first, second) => first - second);
  const pick = (share: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)] ?? 0;

  return { count: sorted.length, p50: pick(0.5), p95: pick(0.95), max: sorted.at(-1) ?? 0 };
}

async function source(home: string, path: string): Promise<string> {
  return readFile(join(home, path), "utf8");
}

/** Columns per tab in the status bar and Go to Line, which count columns as GoLand does. */
const TAB_COLUMNS = 4;

/**
 * The 1-based line and status-bar column of `name` inside the first line containing `line`: a tab runs to the
 * next multiple of `TAB_COLUMNS`, as the editor's status bar and Go to Line count it.
 */
function find(
  text: string,
  line: string,
  name: string,
): { readonly line: number; readonly column: number } {
  const lines = text.split("\n");
  const index = lines.findIndex((each) => each.includes(line));
  const found = lines[index] ?? "";
  const start = found.indexOf(line);
  const word = new RegExp(`\\b${name}\\b`, "u").exec(found.slice(start));

  if (index < 0 || word === null) throw new Error(`"${line}" isn't in the file.`);
  let column = 0;

  for (const character of found.slice(0, start + word.index))
    column = character === "\t" ? column + TAB_COLUMNS - (column % TAB_COLUMNS) : column + 1;

  return { line: index + 1, column: column + 1 };
}

function usages(text: string, call: string): number {
  return text.split("\n").filter((line) => line.includes(call) && !line.includes("func ")).length;
}

function activeTab(page: Page): Locator {
  return editor(page).getByRole("tab", { selected: true });
}

function activePanel(page: Page): Locator {
  return editor(page).locator('[role="tabpanel"]:not([hidden])');
}

function activeText(page: Page): Locator {
  return activePanel(page).getByRole("textbox");
}

function tokenAt(text: Locator, line: number, name: string): Locator {
  return text
    .locator(`[data-line="${String(line)}"] [data-char]`)
    .filter({ hasText: new RegExp(`^${name}$`, "u") });
}

/** Opens a file with Go to File (⌘P), the way the keyboard does. */
async function openPath(page: Page, path: string): Promise<Locator> {
  const name = path.split("/").at(-1) ?? path;

  await page.keyboard.press("Meta+P");
  const palette = page.getByRole("combobox", { name: "Go to file" });

  await expect(palette).toBeVisible();
  await palette.fill(path);
  await expect(page.getByRole("option").first()).toContainText(name);
  await page.keyboard.press("Enter");
  const text = activeText(page);

  await expect(activeTab(page)).toHaveAccessibleName(
    new RegExp(`^${path.replaceAll(".", "\\.")}`, "u"),
  );
  await expect(text).toBeVisible();

  return text;
}

async function frames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}
