/**
 * The canvas previewer for a host without Electron: a headless Chromium
 * already on this machine, driven over the DevTools protocol on a pipe, so
 * nothing new is installed and no debugging port is opened. Each preview
 * starts its own browser with a throwaway profile and stops it after. The
 * page loads the shell directory the chat serves, from a made-up https
 * origin the previewer answers itself under the chat's shell policy and
 * frame sandbox; every other request is refused, no host name resolves,
 * WebRTC may only go through a proxy that leads nowhere, and permission
 * prompts are denied, so the canvas stays as sealed as in the chat.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { Readable, Writable } from "node:stream";
import { runCanvasPreview } from "@nyte-ai/plugin/core/canvas-preview";
import type {
  CanvasPreviewOutcome,
  CanvasPreviewPage,
  CanvasPreviewRequest,
  CanvasPreviewer,
} from "@nyte-ai/plugin/core/canvas-preview";
import { Type } from "typebox";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";

const ORIGIN = "https://canvas.preview/";

/**
 * Returns the shell a previewer serves: every file of the canvas package's
 * `dist/shell`, base64 by its path from it (`index.html`,
 * `libraries/three.js`), as `@nyte-ai/canvas/shell-files` exports them.
 *
 * @category host
 * @since 0.1.0
 */
export type CanvasShellFiles = Readonly<Record<string, string>>;

/** The policy the chat's clients serve the shell's page under, plus the sandbox its frame adds there, so the top-level page gets the frame's opaque origin. */
const SHELL_POLICY =
  "default-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";

const SHELL_TYPES = new Map([
  ["html", "text/html; charset=utf-8"],
  ["js", "text/javascript; charset=utf-8"],
  ["css", "text/css; charset=utf-8"],
  ["woff2", "font/woff2"],
]);

/** The newest browser of `prefix` in Playwright's download cache, which the canvas package's own checks install. */
function playwrightBrowser(prefix: string, executables: readonly string[]): string | undefined {
  const cache =
    process.env["PLAYWRIGHT_BROWSERS_PATH"] ??
    (process.platform === "darwin"
      ? join(homedir(), "Library", "Caches", "ms-playwright")
      : process.platform === "win32"
        ? join(process.env["LOCALAPPDATA"] ?? homedir(), "ms-playwright")
        : join(homedir(), ".cache", "ms-playwright"));

  if (!existsSync(cache)) return undefined;
  const versions = readdirSync(cache)
    .filter((name) => name.startsWith(`${prefix}-`))
    .toSorted(
      (left, right) =>
        Number(right.slice(prefix.length + 1)) - Number(left.slice(prefix.length + 1)),
    );

  return versions
    .flatMap((version) => executables.map((executable) => join(cache, version, executable)))
    .find((path) => existsSync(path));
}

/**
 * Finds a Chromium to preview with: `NYTE_CANVAS_CHROMIUM`, then
 * Playwright's headless shell or Chromium, then an installed Chrome or
 * Chromium. Undefined when there is none.
 *
 * @category host
 * @since 0.1.0
 */
export function findChromium(): string | undefined {
  const named = process.env["NYTE_CANVAS_CHROMIUM"];

  if (named !== undefined && named !== "") return existsSync(named) ? named : undefined;
  const arch = process.arch === "arm64" ? "arm64" : "x64";

  return (
    playwrightBrowser("chromium_headless_shell", [
      `chrome-headless-shell-mac-${arch}/chrome-headless-shell`,
      "chrome-headless-shell-linux64/chrome-headless-shell",
      "chrome-headless-shell-win64/chrome-headless-shell.exe",
    ]) ??
    playwrightBrowser("chromium", [
      `chrome-mac-${arch}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
      "chrome-linux64/chrome",
      "chrome-linux/chrome",
      "chrome-win64/chrome.exe",
    ]) ??
    [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      join(
        process.env["PROGRAMFILES"] ?? "C:\\Program Files",
        "Google/Chrome/Application/chrome.exe",
      ),
    ].find((path) => existsSync(path))
  );
}

const Reply = Type.Object({
  id: Type.Number(),
  result: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  error: Type.Optional(Type.Object({ message: Type.String() })),
});

const Event = Type.Object({
  method: Type.String(),
  params: Type.Record(Type.String(), Type.Unknown()),
  sessionId: Type.Optional(Type.String()),
});

const Paused = Type.Object({
  requestId: Type.String(),
  request: Type.Object({ url: Type.String() }),
});

function read<S extends TSchema>(schema: S, value: unknown, what: string) {
  if (!Value.Check(schema, value)) throw new Error(`Chromium answered ${what} unreadably.`);

  return value;
}

/** One DevTools connection over Chromium's pipe: NUL-terminated JSON both ways. */
class Pipe {
  readonly #write: Writable;
  readonly #waiting = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  readonly #listeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  #next = 0;
  #buffer = "";
  #closed: Error | undefined;

  constructor(write: Writable, readable: Readable) {
    this.#write = write;
    readable.setEncoding("utf8");
    readable.on("data", (chunk: string) => this.#receive(chunk));
    readable.on("close", () => this.close(new Error("Chromium closed its DevTools pipe.")));
    write.on("error", (error: Error) => this.close(error));
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    if (this.#closed !== undefined) return Promise.reject(this.#closed);
    this.#next += 1;
    const id = this.#next;

    return new Promise((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject });
      this.#write.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  }

  listen(listener: (method: string, params: Record<string, unknown>) => void): void {
    this.#listeners.add(listener);
  }

  close(error: Error): void {
    this.#closed ??= error;

    for (const waiting of this.#waiting.values()) waiting.reject(error);
    this.#waiting.clear();
  }

  #receive(chunk: string): void {
    this.#buffer += chunk;
    const messages = this.#buffer.split("\0");
    this.#buffer = messages.pop() ?? "";

    for (const text of messages) {
      const message: unknown = JSON.parse(text);

      if (Value.Check(Reply, message)) {
        const waiting = this.#waiting.get(message.id);
        this.#waiting.delete(message.id);

        if (message.error === undefined) waiting?.resolve(message.result ?? {});
        else waiting?.reject(new Error(message.error.message));
      } else if (Value.Check(Event, message))
        for (const listener of this.#listeners) listener(message.method, message.params);
    }
  }
}

/** Answers the page's requests: the shell's files from memory, nothing else at all. */
function serve(pipe: Pipe, shell: CanvasShellFiles, sessionId: string): void {
  pipe.listen((method, params) => {
    if (method !== "Fetch.requestPaused" || !Value.Check(Paused, params)) return;
    const { requestId, request } = params;
    const requested = request.url.startsWith(ORIGIN)
      ? request.url.slice(ORIGIN.length).split(/[?#]/u)[0]
      : undefined;
    const path = requested === "" ? "index.html" : requested;
    const body = path !== undefined && Object.hasOwn(shell, path) ? shell[path] : undefined;
    const type = SHELL_TYPES.get(path?.split(".").at(-1) ?? "");

    if (path === undefined || body === undefined || type === undefined) {
      void pipe
        .send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId)
        .catch(() => undefined);

      return;
    }

    void pipe
      .send(
        "Fetch.fulfillRequest",
        {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: type },
            { name: "Access-Control-Allow-Origin", value: "*" },
            ...(path === "index.html"
              ? [{ name: "Content-Security-Policy", value: SHELL_POLICY }]
              : []),
          ],
          body,
        },
        sessionId,
      )
      .catch(() => undefined);
  });
}

async function previewIn(
  pipe: Pipe,
  shell: CanvasShellFiles,
  request: CanvasPreviewRequest,
): Promise<CanvasPreviewOutcome> {
  const target = read(
    Type.Object({ targetId: Type.String() }),
    await pipe.send("Target.createTarget", { url: "about:blank" }),
    "a new page",
  );
  const { sessionId } = read(
    Type.Object({ sessionId: Type.String() }),
    await pipe.send("Target.attachToTarget", { targetId: target.targetId, flatten: true }),
    "an attach",
  );
  const send = (method: string, params: Record<string, unknown> = {}) =>
    pipe.send(method, params, sessionId);
  serve(pipe, shell, sessionId);
  const loaded = new Promise<void>((resolve) =>
    pipe.listen((method) => {
      if (method === "Page.loadEventFired") resolve();
    }),
  );
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Page.enable");
  await send("Page.navigate", { url: ORIGIN });
  await loaded;

  const page: CanvasPreviewPage = {
    async evaluate(expression) {
      const answer = read(
        Type.Object({
          result: Type.Object({ value: Type.Optional(Type.Unknown()) }),
          exceptionDetails: Type.Optional(Type.Object({ text: Type.String() })),
        }),
        await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
        "an evaluation",
      );

      if (answer.exceptionDetails !== undefined)
        throw new Error(`The preview page threw: ${answer.exceptionDetails.text}`);

      return answer.result.value;
    },
    async resize(width, height) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    },
    async capture() {
      const { data } = read(
        Type.Object({ data: Type.String() }),
        await send("Page.captureScreenshot", { format: "png" }),
        "a screenshot",
      );

      return new Uint8Array(Buffer.from(data, "base64"));
    },
  };

  return { kind: "rendered", report: await runCanvasPreview(page, request) };
}

function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    const kill = setTimeout(() => child.kill("SIGKILL"), 2000);
    child.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
    child.kill();
  });
}

/**
 * Returns a previewer over a headless Chromium on this machine
 * (`findChromium`), serving `shell`; it answers `unavailable` when there is
 * no Chromium or it fails to start, and stops the browser when the
 * preview's signal aborts.
 *
 * @category host
 * @since 0.1.0
 */
export function chromiumCanvasPreview(
  shell: CanvasShellFiles,
  executable: () => string | undefined = findChromium,
): CanvasPreviewer {
  return async (request, signal) => {
    const path = executable();

    if (path === undefined)
      return {
        kind: "unavailable",
        reason: "No Chrome or Chromium was found on this machine.",
      };
    const profile = await mkdtemp(join(tmpdir(), "nyte-canvas-preview-"));
    const child = spawn(
      path,
      [
        "--headless",
        "--remote-debugging-pipe",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--mute-audio",
        "--deny-permission-prompts",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--proxy-server=socks5://127.0.0.1:9",
        "--proxy-bypass-list=<-loopback>",
        "--host-resolver-rules=MAP * ~NOTFOUND",
        "--hide-scrollbars",
        "--enable-unsafe-swiftshader",
        "--use-mock-keychain",
        "--password-store=basic",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
    );
    const [, , , input, output] = child.stdio;

    try {
      if (!(input instanceof Writable) || !(output instanceof Readable))
        return { kind: "unavailable", reason: "Chromium did not open its DevTools pipe." };
      const pipe = new Pipe(input, output);
      child.once("error", (error) => pipe.close(error));
      const stopped = Promise.withResolvers<never>();
      const stop = (): void => stopped.reject(new Error("The preview was stopped."));
      signal.addEventListener("abort", stop, { once: true });

      try {
        signal.throwIfAborted();

        return await Promise.race([previewIn(pipe, shell, request), stopped.promise]);
      } catch (error) {
        return {
          kind: "unavailable",
          reason: `Chromium could not render the preview: ${error instanceof Error ? error.message : String(error)}`,
        };
      } finally {
        signal.removeEventListener("abort", stop);
        void pipe.send("Browser.close").catch(() => undefined);
        pipe.close(new Error("The preview finished."));
      }
    } finally {
      await stop(child);
      await rm(profile, { recursive: true, force: true });
    }
  };
}
