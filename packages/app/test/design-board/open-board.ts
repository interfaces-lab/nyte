import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { Browser, Frame, FrameLocator, Page } from "@playwright/test";
import { readBoardMessage } from "@nyte-ai/plugin/design/board-protocol";
import type { AppMessage, BoardMessage } from "@nyte-ai/plugin/design/board-protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { build, createServer as createViteServer, defaultClientConditions } from "vite";
import type { ViteDevServer } from "vite";
import { canvasShell } from "../../vite.ts";
import { ofKind } from "./harness/harness-api.ts";
import type { Pattern, Posted } from "./harness/harness-api.ts";

export interface OpenBoard extends AsyncDisposable {
  readonly page: Page;
  /** The board's frame, for evaluating in its document. */
  readonly frame: Frame;
  /** The board's document, inside the harness's sandboxed iframe. */
  readonly board: FrameLocator;
  /** Compiles the files with the app's `buildBoard`, sends the load, and returns its build. */
  readonly load: (files: Readonly<Record<string, string>>) => Promise<number>;
  /**
   * Sends the last load again twice, waiting for each `drawn`. Messages to the board run in order, and the first load
   * is handled after every message sent before it, so React's render of those messages is queued before the second
   * load arrives: when it returns, what they changed is on screen.
   */
  readonly handledAndRendered: () => Promise<void>;
  readonly send: (message: AppMessage) => Promise<void>;
  /** How many messages the board has posted so far. */
  readonly mark: () => Promise<number>;
  readonly posted: (since: number) => Promise<readonly BoardMessage[]>;
  /** Waits for a message of `kind` posted from `since` on that matches `pattern`. */
  readonly waitForPost: <Kind extends BoardMessage["kind"]>(
    kind: Kind,
    pattern: Pattern<BoardMessage>,
    since: number,
  ) => Promise<Posted<Kind>>;
  /** Moves the paused clock of every frame forward, firing the timers and animation frames due in that time. */
  readonly advance: (milliseconds: number) => Promise<void>;
  /**
   * Advances the clock in 16 ms frame steps through 1 s, past the board's only edit timer (the 600 ms typing pause in
   * `gestures.ts`) with 400 ms for work it queues, then keeps stepping until three steps in a row post nothing (at most
   * 120 more). Each step is its own clock call, so the frames and microtasks it queues run before the next. Returns every
   * message posted from `since` up to the last fence: nothing the board posted before a fence can arrive after it.
   */
  readonly settlePastEditTimersUntilQuiet: (since: number) => Promise<readonly BoardMessage[]>;
  /** Uncaught page errors, messages that are neither board messages nor fences, and console reports of a blocked load. */
  readonly problems: () => Promise<{
    readonly pageErrors: readonly string[];
    readonly unreadable: readonly unknown[];
    readonly policyViolations: readonly string[];
  }>;
}

export interface BoardSuite {
  readonly open: () => Promise<OpenBoard>;
  readonly close: () => Promise<void>;
}

export const VIEWPORT = { width: 1400, height: 900 } as const;

/** Where every board's clock stands, paused: logical time moves only when a test advances it. */
export const PAUSED_AT = Date.parse("2030-01-01T00:00:00.000Z");

const FRAME_MS = 16;

const PAST_EDIT_TIMERS_MS = 1000;

const QUIET_STEPS = 3;

const MAX_QUIET_STEPS = 120;

const WAIT_MS = 3000;

const INSTALL_SHELL = "pnpm --dir packages/app exec playwright install chromium-headless-shell";

/** The environment variable that skips the suite when set to `1`; nothing else does. */
export const SKIP_VARIABLE = "NYTE_SKIP_DESIGN_BOARD";

const TYPES = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".wasm", "application/wasm"],
]);

const ListeningType = Type.Object({ port: Type.Integer({ minimum: 1 }) });

const FencedType = Type.Object({ at: Type.Integer({ minimum: 0 }) });

/**
 * Builds the harness page and the real board into two temp folders the suite owns. The harness is served at `/`;
 * `/canvas/` goes through the app's `canvasShell` middleware, given the board's folder, so the board document carries
 * the production board policy and headers. Starts Playwright's pinned
 * headless shell. Every Playwright wait on a board lasts 3 s, under the test's own timeout, so a failure names what it
 * waited for.
 */
export async function openBoardSuite(): Promise<BoardSuite> {
  await using stack = new AsyncDisposableStack();
  const directory = await mkdtemp(join(tmpdir(), "nyte-design-board-"));
  stack.defer(() => rm(directory, { recursive: true, force: true }));
  const harness = fileURLToPath(new URL("harness/", import.meta.url));

  const canvas = realpathSync(
    fileURLToPath(new URL("../../node_modules/@nyte-ai/canvas/", import.meta.url)),
  );

  await build({
    configFile: false,
    root: harness,
    base: "./",
    logLevel: "silent",
    resolve: { conditions: ["nyte-source", ...defaultClientConditions] },
    build: {
      outDir: directory,
      emptyOutDir: true,
      rolldownOptions: { input: join(harness, "index.html") },
    },
  });
  const board = await mkdtemp(join(tmpdir(), "nyte-design-board-board-"));
  stack.defer(() => rm(board, { recursive: true, force: true }));
  await build({
    configFile: join(canvas, "vite.board.config.ts"),
    root: join(canvas, "src/board"),
    logLevel: "silent",
    build: { outDir: board, emptyOutDir: true },
  });

  const shell = await createViteServer({
    configFile: false,
    root: directory,
    logLevel: "silent",
    appType: "custom",
    plugins: [canvasShell({ board })],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });

  stack.defer(() => shell.close());
  const server = await listen(createServer(respond(directory, shell)));
  stack.defer(() => close(server));
  const address = server.address();

  if (!Value.Check(ListeningType, address)) throw new Error("The board server is not listening.");
  const origin = `http://127.0.0.1:${String(address.port)}`;
  const browser = await launch();
  stack.defer(() => browser.close());
  const owned = stack.move();

  return { open: () => openBoard(browser, origin), close: () => owned.disposeAsync() };
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chromium-headless-shell", headless: true });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Executable doesn't exist")) {
      throw error;
    }

    throw new Error(
      `Playwright's headless shell is not installed. Install it once with \`${INSTALL_SHELL}\`, or set ${SKIP_VARIABLE}=1 to skip this suite.`,
      { cause: error },
    );
  }
}

async function openBoard(browser: Browser, origin: string): Promise<OpenBoard> {
  await using stack = new AsyncDisposableStack();
  const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: "reduce" });
  stack.defer(() => context.close());
  context.setDefaultTimeout(WAIT_MS);
  await context.clock.install({ time: PAUSED_AT - 60_000 });
  await context.clock.pauseAt(PAUSED_AT);
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const policyViolations: string[] = [];
  const policies: (string | undefined)[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) policyViolations.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().endsWith("/canvas/board/board.html")) {
      policies.push(response.headers()["content-security-policy"]);
    }
  });

  const waitForPost: OpenBoard["waitForPost"] = async (kind, pattern, since) => {
    const found = await page
      .waitForFunction((input) => window.harness.find(input.kind, input.pattern, input.since), {
        kind,
        pattern,
        since,
      })
      .catch((error: unknown) => {
        throw new Error(
          `The board posted no ${kind} matching ${JSON.stringify(pattern)} after message ${String(since)}.`,
          { cause: error },
        );
      });

    const message = readBoardMessage(await found.jsonValue());

    if (!ofKind(message, kind)) throw new Error(`Expected a ${kind} message.`);

    return message;
  };

  const posted = (since: number, until?: number): Promise<readonly BoardMessage[]> =>
    page.evaluate((input) => window.harness.posted.slice(input.since, input.until), {
      since,
      until,
    });

  const mark = (): Promise<number> => page.evaluate(() => window.harness.posted.length);

  await page.goto(`${origin}/index.html`);
  await waitForPost("ready", {}, 0);
  const frame = page.frame({ url: /\/canvas\/board\/board\.html$/u });

  if (frame === null) throw new Error("The board frame is not in the harness.");

  if (policies.length !== 1 || policies[0] === undefined || policies[0] === "") {
    throw new Error("The board document was served without its Content-Security-Policy.");
  }

  if ((await frame.evaluate(() => Date.now())) !== PAUSED_AT) {
    throw new Error("The paused clock did not reach the sandboxed board frame.");
  }

  let fences = 0;

  const fence = async (): Promise<number> => {
    fences += 1;
    const token = fences;
    await postFence(frame, token);

    const handle = await page.waitForFunction((value) => {
      const at = window.harness.fenced(value);

      return at === null ? null : { at };
    }, token);

    const fenced = await handle.jsonValue();

    if (!Value.Check(FencedType, fenced)) throw new Error("The fence did not arrive.");

    return fenced.at;
  };

  const owned = stack.move();

  return {
    page,
    frame,
    board: page.frameLocator('iframe[title="Design board"]'),
    load: (files) => page.evaluate((input) => window.harness.load(input), files),
    handledAndRendered: async () => {
      for (const _load of [1, 2]) {
        const since = await mark();
        await page.evaluate(() => window.harness.resend());
        await waitForPost("drawn", {}, since);
      }
    },
    send: (message) => page.evaluate((input) => window.harness.send(input), message),
    mark,
    posted,
    waitForPost,
    advance: (milliseconds) => page.clock.runFor(milliseconds),
    settlePastEditTimersUntilQuiet: async (since) => {
      for (let ran = 0; ran < PAST_EDIT_TIMERS_MS; ran += FRAME_MS) {
        await page.clock.runFor(FRAME_MS);
      }
      let end = await fence();

      for (let quiet = 0, step = 0; quiet < QUIET_STEPS; step += 1) {
        if (step === MAX_QUIET_STEPS) throw new Error("The board kept posting as its clock ran.");
        await page.clock.runFor(FRAME_MS);
        const next = await fence();
        quiet = next === end ? quiet + 1 : 0;
        end = next;
      }

      return posted(since, end);
    },
    problems: async () => ({
      pageErrors,
      unreadable: await page.evaluate(() => window.harness.unreadable),
      policyViolations,
    }),
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}

function postFence(frame: Frame, token: number): Promise<void> {
  return frame.evaluate((value) => window.parent.postMessage({ fence: value }, "*"), token);
}

function respond(
  directory: string,
  shell: ViteDevServer,
): (request: IncomingMessage, response: ServerResponse) => void {
  const missing = (response: ServerResponse): void => {
    response.writeHead(404);
    response.end();
  };

  return (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;

    if (path.startsWith("/canvas/")) {
      shell.middlewares(request, response, () => missing(response));

      return;
    }

    void readFile(join(directory, path)).then(
      (body) => {
        response.writeHead(200, {
          "Content-Type": TYPES.get(extname(path)) ?? "application/octet-stream",
        });
        response.end(body);
      },
      () => missing(response),
    );
  };
}

function listen(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function close(server: Server): Promise<void> {
  server.closeAllConnections();

  return new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}
