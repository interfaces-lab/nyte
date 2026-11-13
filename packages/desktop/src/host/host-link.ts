import { operationsDigest, SdkError, sdk } from "@nyte-ai/sdk/client";
import type { Connection, HostView } from "@nyte-ai/sdk/client";
import type { Disposer } from "@nyte-ai/schema";
import { HOST_PORT_ORIGIN } from "../shared/host-port.ts";
import { retainDiagnostic } from "../shared/errors.ts";

export type HostLinkState =
  | { readonly kind: "connecting" }
  | {
      readonly kind: "connected";
      readonly version: string;
      readonly compatible: boolean;
    }
  | { readonly kind: "unreachable"; readonly message: string };

/** The waits between attempts while the host does not answer. The route is the home's local socket, where a refused connect costs one system call, so a host that starts or restarts is seen within a second of listening. */
const RETRY_MS = [100, 250, 500, 1_000] as const;

/**
 * Desktop main's one link to the host: the connection main calls it on, the host view main
 * follows, and whether the host answers. A connection lasts as long as the host process that
 * answered it: once its view says the link is lost, the link closes it and dials again on its own
 * short curve, so main sees a host that comes back, or one that takes its place, as soon as it
 * answers, and never holds a connection that closed for good.
 */
export class HostLink {
  readonly #fetch: (request: Request) => Promise<Response>;
  readonly #changed: (state: HostLinkState) => void;
  readonly #stop = new AbortController();
  readonly #viewers = new Set<(view: HostView) => void>();
  #state: HostLinkState = { kind: "connecting" };
  #view: HostView | undefined;
  #held: Connection | undefined;
  #waiting: PromiseWithResolvers<Connection> | undefined;
  #wake: (() => void) | undefined;

  constructor(
    fetch: (request: Request) => Promise<Response>,
    changed: (state: HostLinkState) => void,
  ) {
    this.#fetch = fetch;
    this.#changed = changed;
  }

  get state(): HostLinkState {
    return this.#state;
  }

  /** The connection to the host. While the host does not answer, it dials at once and settles with that attempt. */
  connection(): Promise<Connection> {
    if (this.#stop.signal.aborted)
      return Promise.reject(new SdkError("unavailable", "The desktop's host link is closed."));

    if (this.#held !== undefined) return Promise.resolve(this.#held);
    this.#waiting ??= Promise.withResolvers();
    this.#wake?.();

    return this.#waiting.promise;
  }

  /** Calls `viewer` with the host's view now, when the link has one, and with every view after. */
  follow(viewer: (view: HostView) => void): Disposer {
    this.#viewers.add(viewer);

    if (this.#view !== undefined) this.#show(viewer, this.#view);

    return () => {
      this.#viewers.delete(viewer);
    };
  }

  start(): void {
    void this.#follow();
  }

  /** Dials now instead of waiting out the pause, when something says the host may be back: the machine woke. */
  retry(): void {
    this.#wake?.();
  }

  close(): void {
    this.#stop.abort();
    this.#waiting?.reject(new SdkError("unavailable", "The desktop's host link is closed."));
    this.#waiting = undefined;
  }

  async #follow(): Promise<void> {
    const own = await operationsDigest();
    let failures = 0;

    while (!this.#stop.signal.aborted) {
      failures = (await this.#hold(own)) ? 0 : failures + 1;
      await this.#pause(RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
    }
  }

  /** Connects and follows the view until the link is lost. Returns whether the host answered. */
  async #hold(own: string): Promise<boolean> {
    const connection = await sdk
      .connect({
        url: HOST_PORT_ORIGIN,
        credentials: { kind: "custom", headers: () => ({}) },
        fetch: (url, init) => this.#fetch(new Request(url, init)),
      })
      .catch((cause: unknown) => {
        this.#unreachable(cause instanceof Error ? cause.message : String(cause), cause);

        return undefined;
      });

    if (connection === undefined) return false;
    const close = (): void => void connection.close().catch(() => undefined);

    if (this.#stop.signal.aborted) {
      close();

      return true;
    }

    this.#stop.signal.addEventListener("abort", close, { once: true });
    this.#held = connection;
    this.#waiting?.resolve(connection);
    this.#waiting = undefined;

    const lost = await this.#watch(connection, own).then(
      () => "The Nyte host stopped answering.",
      (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
    );

    this.#held = undefined;
    this.#stop.signal.removeEventListener("abort", close);
    close();

    if (!this.#stop.signal.aborted) this.#set({ kind: "unreachable", message: lost });

    return true;
  }

  async #watch(connection: Connection, own: string): Promise<void> {
    for await (const view of connection.watch()) {
      if (view.link.kind !== "connected" || this.#stop.signal.aborted) return;
      this.#view = view;
      this.#set({
        kind: "connected",
        version: view.version,
        compatible: view.operations === null || view.operations === own,
      });

      for (const viewer of this.#viewers) this.#show(viewer, view);
    }
  }

  #show(viewer: (view: HostView) => void, view: HostView): void {
    try {
      viewer(view);
    } catch (cause) {
      retainDiagnostic({ correlationId: "desktop-host-view", cause });
    }
  }

  #unreachable(message: string, cause: unknown): void {
    this.#waiting?.reject(cause);
    this.#waiting = undefined;

    if (!this.#stop.signal.aborted) this.#set({ kind: "unreachable", message });
  }

  #pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.#stop.signal.removeEventListener("abort", done);
        this.#wake = undefined;
        resolve();
      };

      const timer = setTimeout(done, ms);
      this.#stop.signal.addEventListener("abort", done, { once: true });
      this.#wake = done;
    });
  }

  #set(state: HostLinkState): void {
    if (JSON.stringify(state) === JSON.stringify(this.#state)) return;
    this.#state = state;
    this.#changed(state);
  }
}
