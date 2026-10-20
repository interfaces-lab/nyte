import type { WebContents } from "electron";
import type { HostEvent } from "@nyte-ai/app/bridge.ts";
import type { SessionId } from "@nyte-ai/sdk";
import { sessionSurfaceId } from "./browser-agent.ts";
import type { BrowserAgent, BrowserHolder, BrowserOwner } from "./browser-agent.ts";
import { webUrl } from "./browser-policy.ts";
import {
  performCapture,
  performClick,
  performEvaluate,
  performPress,
  performScroll,
  performType,
  performWait,
  takeSnapshot,
} from "./browser-runtime.ts";
import type { Surface } from "./browser-surface.ts";

export interface AgentSurfaces {
  readonly emit: (event: HostEvent) => void;
  surface(id: string): Surface | undefined;
  retain(id: string, holder: BrowserHolder, owner: BrowserOwner): Surface;
  release(id: string, holder: BrowserHolder): void;
  load(surface: Surface, url: string): void;
  place(surface: Surface): void;
  reclaimIdle(): void;
  touch(surface: Surface): void;
  windowShown(surface: Surface): boolean;
}

const CLOSED = { kind: "failed", failure: { kind: "closed" } } as const;

const SETTLE_LIMIT_MS = 10_000;

function waitForSettle(contents: WebContents, signal?: AbortSignal): Promise<void> {
  if (contents.isDestroyed() || !contents.isLoading()) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const done = () => {
      if (timer !== undefined) clearTimeout(timer);
      contents.removeListener("did-stop-loading", done);
      contents.removeListener("did-fail-load", done);
      contents.removeListener("destroyed", done);
      signal?.removeEventListener("abort", done);
      resolve();
    };

    timer = setTimeout(done, SETTLE_LIMIT_MS);
    contents.on("did-stop-loading", done);
    contents.on("did-fail-load", done);
    contents.on("destroyed", done);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export class SurfaceAgent implements BrowserAgent {
  readonly #surfaces: AgentSurfaces;

  constructor(surfaces: AgentSurfaces) {
    this.#surfaces = surfaces;
  }

  async open(input: Parameters<BrowserAgent["open"]>[0]): ReturnType<BrowserAgent["open"]> {
    const target = webUrl(input.url);

    if (target === undefined) return CLOSED;

    const surface = this.#surfaces.retain(
      sessionSurfaceId(input.session),
      `session:${input.session}`,
      input.owner,
    );

    return this.#operate(surface, async (contents) => {
      if (contents.isDestroyed()) return CLOSED;

      if (contents.getURL() !== target || surface.error !== undefined) {
        this.#surfaces.load(surface, target);
      }

      this.#surfaces.place(surface);
      this.#surfaces.emit({
        kind: "browser_agent_opened",
        owner: input.owner.kind === "project" ? input.owner.path : null,
        url: target,
      });

      await waitForSettle(contents, input.signal);

      if (contents.isDestroyed()) return CLOSED;

      return { kind: "ok", state: await takeSnapshot(contents, surface.runtime) };
    });
  }

  async snapshot(
    input: Parameters<BrowserAgent["snapshot"]>[0],
  ): ReturnType<BrowserAgent["snapshot"]> {
    const surface = this.#session(input.session);

    if (surface === undefined) return CLOSED;

    return this.#operate(surface, async (contents) => {
      if (contents.isDestroyed()) return CLOSED;

      return { kind: "ok", state: await takeSnapshot(contents, surface.runtime, input.ref) };
    });
  }

  async click(input: Parameters<BrowserAgent["click"]>[0]): ReturnType<BrowserAgent["click"]> {
    const surface = this.#session(input.session);

    if (surface === undefined) return CLOSED;

    return this.#operate(surface, (contents) =>
      performClick(
        contents,
        surface.runtime,
        input.ref,
        input.button ?? "left",
        input.double ?? false,
        this.#surfaces.windowShown(surface),
        input.signal,
      ),
    );
  }

  async type(input: Parameters<BrowserAgent["type"]>[0]): ReturnType<BrowserAgent["type"]> {
    const surface = this.#session(input.session);

    if (surface === undefined) return CLOSED;
    surface.pressed.splice(0);

    return this.#operate(surface, (contents) =>
      performType(
        contents,
        surface.runtime,
        input.ref,
        input.text,
        input.clear ?? false,
        input.submit ?? false,
        this.#surfaces.windowShown(surface),
        input.signal,
      ),
    );
  }

  async press(input: Parameters<BrowserAgent["press"]>[0]): ReturnType<BrowserAgent["press"]> {
    const surface = this.#session(input.session);

    if (surface === undefined) return CLOSED;
    surface.pressed.splice(0);

    return this.#operate(surface, (contents) =>
      performPress(
        contents,
        surface.runtime,
        input.key,
        input.ref,
        this.#surfaces.windowShown(surface),
        input.signal,
      ),
    );
  }

  async scroll(input: Parameters<BrowserAgent["scroll"]>[0]): ReturnType<BrowserAgent["scroll"]> {
    const surface = this.#session(input.session);

    if (surface === undefined) return CLOSED;

    return this.#operate(surface, (contents) =>
      performScroll(
        contents,
        surface.runtime,
        input,
        this.#surfaces.windowShown(surface),
        input.signal,
      ),
    );
  }

  async wait(input: Parameters<BrowserAgent["wait"]>[0]): ReturnType<BrowserAgent["wait"]> {
    const surface = this.#session(input.session);

    if (surface === undefined) return CLOSED;

    return this.#operate(surface, (contents) =>
      performWait(contents, surface.runtime, input, input.signal),
    );
  }

  async console(
    input: Parameters<BrowserAgent["console"]>[0],
  ): ReturnType<BrowserAgent["console"]> {
    const surface = this.#session(input.session);

    if (surface === undefined) return [];

    const entries = surface.runtime.consoleBuffer.slice(0, input.limit);

    if (input.clear) surface.runtime.consoleBuffer.length = 0;

    return entries;
  }

  async evaluate(
    input: Parameters<BrowserAgent["evaluate"]>[0],
  ): ReturnType<BrowserAgent["evaluate"]> {
    const surface = this.#session(input.session);

    if (surface === undefined)
      return { kind: "threw", message: "No page is open for this session" };

    return this.#operate(surface, (contents) =>
      performEvaluate(contents, surface.runtime, input.expression, input.ref),
    );
  }

  async capture(
    input: Parameters<BrowserAgent["capture"]>[0],
  ): ReturnType<BrowserAgent["capture"]> {
    const surface = this.#session(input.session);

    if (surface === undefined) return undefined;

    return this.#operate(surface, performCapture);
  }

  release(input: Parameters<BrowserAgent["release"]>[0]): void {
    this.#surfaces.release(sessionSurfaceId(input.session), `session:${input.session}`);
  }

  sessionSurfaceId(sessionId: SessionId): string {
    return sessionSurfaceId(sessionId);
  }

  #session(sessionId: SessionId): Surface | undefined {
    return this.#surfaces.surface(sessionSurfaceId(sessionId));
  }

  async #operate<T>(surface: Surface, run: (contents: WebContents) => Promise<T>): Promise<T> {
    const contents = surface.view.webContents;
    surface.operations += 1;
    this.#surfaces.touch(surface);

    try {
      if (surface.operations === 1 && !contents.isDestroyed()) {
        contents.setBackgroundThrottling(false);
      }

      this.#surfaces.reclaimIdle();

      return await run(contents);
    } finally {
      surface.operations -= 1;
      this.#surfaces.touch(surface);

      if (surface.operations === 0 && !surface.destroyed && !contents.isDestroyed()) {
        contents.setBackgroundThrottling(true);
      }

      this.#surfaces.reclaimIdle();
    }
  }
}
