/**
 * One desktop per spec file: a worker launches the e2e build over a copy
 * of the seeded baseline once, and every test in the file drives that same
 * window. A file names itself with `test.use({ chapter })`, which keys its
 * own worker, so any chapter runs alone with a single launch. Each test
 * records its own trace chunk and fails on any page or console error.
 */
import { expect, test as base } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareHome } from "./baseline.ts";
import type { PreparedHome } from "./baseline.ts";
import { launchDesktop } from "./launch.ts";

export interface Desktop extends PreparedHome {
  readonly application: ElectronApplication;
  readonly page: Page;
  /** Where the desktop saves downloads for this chapter. */
  readonly downloads: string;
  /** The main process's stdout and stderr since launch. */
  readonly output: readonly string[];
}

interface WorkerFixtures {
  readonly chapter: string;
  readonly desktop: Desktop;
}

interface TestFixtures {
  readonly problems: void;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  chapter: ["", { scope: "worker", option: true }],
  desktop: [
    async ({ chapter }, use) => {
      if (chapter === "") throw new Error("A desktop spec must declare test.use({ chapter }).");
      const parent = await realpath(await mkdtemp(join(tmpdir(), `nyte-e2e-${chapter}-`)));
      await using stack = new AsyncDisposableStack();
      stack.defer(() => rm(parent, { recursive: true, force: true }));
      const prepared = await prepareHome(parent);
      const downloads = join(parent, "downloads");
      await mkdir(downloads);
      const launched = await launchDesktop({
        home: prepared.home,
        parentDirectory: parent,
        downloadsDirectory: downloads,
      });
      stack.defer(() => launched.close());
      const tracing = launched.application.context().tracing;
      await tracing.start({ screenshots: true, snapshots: true });
      stack.defer(() => tracing.stop());

      await use({
        application: launched.application,
        page: launched.page,
        downloads,
        output: launched.output,
        home: prepared.home,
        sessions: prepared.sessions,
      });
    },
    { scope: "worker", timeout: 240_000 },
  ],
  problems: [
    async ({ desktop }, use, testInfo) => {
      const { page } = desktop;
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const failedResponses: string[] = [];
      const onPageError = (error: Error): number => pageErrors.push(error.message);
      const onConsole = (message: { type(): string; text(): string }): void => {
        // Core's `dev()` trace goes to `console.error` by design; it is not an error.
        if (message.type() === "error" && !message.text().startsWith("DEV:"))
          consoleErrors.push(message.text());
      };
      const onResponse = (response: { status(): number; url(): string }): void => {
        if (response.status() >= 400)
          failedResponses.push(`${String(response.status())} ${response.url()}`);
      };

      page.on("pageerror", onPageError);
      page.on("console", onConsole);
      page.on("response", onResponse);
      const outputStart = desktop.output.length;
      const tracing = desktop.application.context().tracing;
      await tracing.startChunk({ title: testInfo.title });

      try {
        await use();
      } finally {
        page.off("pageerror", onPageError);
        page.off("console", onConsole);
        page.off("response", onResponse);
        const failed =
          testInfo.status !== testInfo.expectedStatus ||
          pageErrors.length > 0 ||
          consoleErrors.length > 0 ||
          failedResponses.length > 0;

        if (failed) {
          const path = testInfo.outputPath("trace.zip");
          await tracing.stopChunk({ path });
          await testInfo.attach("trace", { path, contentType: "application/zip" });
          await testInfo.attach("main-process-output", {
            body: desktop.output.slice(outputStart).join(""),
            contentType: "text/plain",
          });
        } else await tracing.stopChunk();
      }

      expect(pageErrors, "uncaught page errors").toEqual([]);
      expect(consoleErrors, "console errors").toEqual([]);
      expect(failedResponses, "HTTP responses of 400 or above").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
