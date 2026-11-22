import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect } from "@playwright/test";
import type { Browser, BrowserContext, FrameLocator, Locator, Page } from "@playwright/test";
import { sdk } from "@nyte-ai/sdk";
import { E2E_ORIGIN, E2E_TOKEN } from "../server/address.ts";
import { DESIGN_SAMPLE } from "./design-sample.ts";
import { collectErrors } from "./errors.ts";
import { pair } from "./pairing.ts";

const run = promisify(execFile);

export interface DesignWorkspace {
  /** The workspace's folder on the host. */
  readonly root: string;
  /** The folder's name, as the workspace menu shows it. */
  readonly name: string;
  /** The absolute path of a file named from the workspace root, such as `design/controls.jsx`. */
  file(path: string): string;
}

/**
 * A Git workspace of its own, with the sample designs in `design` and `files` (by path from the root) beside them. The
 * stack removes the folder and has the web server forget the workspace, with its chats.
 */
export async function designWorkspace(
  stack: AsyncDisposableStack,
  files: Readonly<Record<string, string>> = {},
): Promise<DesignWorkspace> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-design-")));
  stack.defer(() => rm(root, { recursive: true, force: true }));
  await cp(DESIGN_SAMPLE, join(root, "design"), { recursive: true });

  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }

  for (const args of [
    ["init", "-q"],
    ["config", "user.name", "E2E Author"],
    ["config", "user.email", "e2e@example.test"],
    ["add", "--", "."],
    ["commit", "-qm", "Seed designs"],
  ]) {
    await run("git", args, { cwd: root });
  }

  stack.defer(async () => {
    await using host = await sdk.connect({
      url: E2E_ORIGIN,
      credentials: { kind: "token", token: E2E_TOKEN },
    });

    const known = (await host.workspaces.list()).find(
      (workspace) => "path" in workspace.target && workspace.target.path === root,
    );

    if (known !== undefined) await host.workspaces.forget(known.id);
  });

  return { root, name: basename(root), file: (path) => join(root, path) };
}

/** A browser context of the test's own, closed by the stack, with a page paired to the web server and its errors collected. */
export async function pairedPage(
  browser: Browser,
  stack: AsyncDisposableStack,
): Promise<{
  readonly context: BrowserContext;
  readonly page: Page;
  readonly errors: ReturnType<typeof collectErrors>;
}> {
  const context = await browser.newContext();
  stack.defer(() => context.close());
  const page = await context.newPage();
  const errors = collectErrors(page);
  await pair(page);

  return { context, page, errors };
}

export interface DesignTab {
  readonly workbench: Locator;
  /** The board's sandboxed document. */
  readonly board: FrameLocator;
  /** The board's stage, which says `data-moving` while its camera flies. */
  readonly stage: Locator;
  /** The design list, once "Show designs" opens it. */
  readonly list: Locator;
  /** A frame the designs draw, by its `data-frame` name. */
  frame(name: string): Locator;
  /** The board's label over a frame, by the frame's name. */
  label(name: string): Locator;
}

/** Opens `workspace` in the active pane from its workspace menu's Open Folder…, then the workbench's Design tab, and waits for the sample's Tonight screen. */
export async function openDesignTab(page: Page, workspace: DesignWorkspace): Promise<DesignTab> {
  const pane = page.getByRole("region", { name: "Active chat pane" });
  await pane.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open Folder…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Folder on Host" });
  await dialog.getByRole("textbox", { name: "Full path on the host" }).fill(workspace.root);
  await dialog.getByRole("button", { name: "Add Folder", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(pane.getByRole("button", { name: workspace.name, exact: true })).toBeVisible();

  const workbench = page.getByRole("complementary", { name: "Workbench" });
  await page
    .getByRole("navigation", { name: "Workbench navigation" })
    .getByRole("button", { name: "Design", exact: true })
    .click();

  const board = page.getByTitle("Design board", { exact: true }).contentFrame();
  const stage = board.getByRole("application", { name: "Design board" });

  const tab: DesignTab = {
    workbench,
    board,
    stage,
    list: workbench.getByRole("navigation", { name: "Designs" }),
    frame: (name) => board.locator(`[data-frame=${JSON.stringify(name)}]`),
    label: (name) => board.locator(`[data-label][data-name=${JSON.stringify(name)}]`),
  };

  await expect(tab.frame("Tonight")).toBeVisible();
  await expect(stage).not.toHaveAttribute("data-moving");

  return tab;
}
