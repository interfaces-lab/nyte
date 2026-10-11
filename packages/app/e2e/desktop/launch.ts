/**
 * Launches the built desktop for the `desktop` project: a fresh home under
 * the caller's directory, chats seeded through `sdk.open` over the same
 * `.nyte/nyte.db` the desktop opens, and the Electron main entry run with
 * that home. Nothing reaches a provider; the store is the one the app reads.
 */
import { _electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import electronExecutable from "electron";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { localProvider, sqliteStore } from "@nyte-ai/host";
import { sdk } from "@nyte-ai/sdk";

const DESKTOP_ROOT = resolve(import.meta.dirname, "../../../desktop");

export interface LaunchOptions {
  /** Where the app path is made; the unpackaged desktop serves `<parent>/app/dist`. */
  readonly parentDirectory: string;
  readonly downloadsDirectory?: string;
  /** Chat names created in the store before the app starts. */
  readonly sessions?: readonly string[];
}

export interface LaunchedDesktop {
  readonly application: ElectronApplication;
  readonly page: Page;
  readonly sessions: readonly string[];
  readonly pageErrors: readonly string[];
  close(): Promise<void>;
}

/** Creates each named chat in the store at `<home>/.nyte/nyte.db`, then closes that host. */
async function seedSessions(home: string, names: readonly string[]): Promise<void> {
  await mkdir(join(home, ".nyte"), { recursive: true, mode: 0o700 });

  const host = await sdk.open({
    store: sqliteStore({ path: join(home, ".nyte", "nyte.db") }),
    plugins: [{ id: "local", environment: localProvider({ home }) }],
    workspace: { kind: "local", path: home },
    home,
  });

  try {
    for (const name of names) await host.sessions.create({ name });
  } finally {
    await host.close();
  }
}

/** Starts the desktop over a fresh home and waits until its shell and the first seeded chat show. */
export async function launchDesktop(options: LaunchOptions): Promise<LaunchedDesktop> {
  const mainEntry = resolve(DESKTOP_ROOT, "out/main/index.js");
  await access(mainEntry);
  const root = await mkdtemp(join(options.parentDirectory, "desktop-"));
  const home = join(root, "home");
  const appData = join(root, "app-data");
  const sessions = options.sessions ?? [];
  await mkdir(appData, { recursive: true });
  await seedSessions(home, sessions);

  const downloads =
    options.downloadsDirectory === undefined
      ? ""
      : `app.setPath("downloads", ${JSON.stringify(resolve(options.downloadsDirectory))});\n`;

  await writeFile(
    join(root, "environment.mjs"),
    `import { app } from "electron";\napp.setPath("appData", ${JSON.stringify(appData)});\napp.setPath("userData", ${JSON.stringify(join(appData, "user-data"))});\n${downloads}`,
  );
  await writeFile(
    join(root, "entry.mjs"),
    `import "./environment.mjs";\nimport ${JSON.stringify(pathToFileURL(mainEntry).href)};\n`,
  );

  const metadata = Value.Parse(
    Type.Object({ name: Type.String(), version: Type.String() }),
    JSON.parse(await readFile(join(DESKTOP_ROOT, "package.json"), "utf8")),
  );

  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: metadata.name, version: metadata.version, main: "entry.mjs" }),
  );
  await symlink(join(DESKTOP_ROOT, "resources"), join(root, "resources"), "junction");

  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
    ),
  );

  const application = await _electron.launch({
    executablePath: Value.Parse(Type.String(), electronExecutable),
    args: [root, "--use-mock-keychain", "--password-store=basic"],
    cwd: DESKTOP_ROOT,
    env: { ...environment, HOME: home },
    timeout: 30_000,
  });

  const close = async (): Promise<void> => {
    await application.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  };

  try {
    const pageErrors: string[] = [];
    const page = await application.firstWindow();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });
    const [first] = sessions;

    if (first !== undefined)
      await page
        .getByRole("navigation", { name: "Sessions and workspaces" })
        .getByRole("button", { name: first })
        .waitFor({ state: "visible", timeout: 30_000 });

    return { application, page, sessions, pageErrors, close };
  } catch (cause) {
    await close();
    throw cause;
  }
}
