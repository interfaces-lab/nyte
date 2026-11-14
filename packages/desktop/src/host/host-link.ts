import { operationsDigest, SdkError } from "@nyte-ai/sdk/client";
import type { ClientConnection, HostView } from "@nyte-ai/sdk/client";
import type { Disposer } from "@nyte-ai/schema";
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

type Attached = (connection: ClientConnection) => Disposer;

/**
 * Desktop main's one connection to the host: the calls main makes, the host view and session rows
 * it follows, the actions it offers, and whether the host answers. A connection lasts as long as
 * the host process that answered it: once its view says the link is lost, the link closes it and
 * dials again on its own short curve, so main sees a host that comes back, or one that takes its
 * place, as soon as it answers, and never holds a connection that closed for good. What needs the
 * connection's socket attaches through `attach`, and is attached again to each connection after.
 */
export class HostLink {
  readonly #dial: () => Promise<ClientConnection>;
  readonly #changed: (state: HostLinkState) => void;
  readonly #stop = new AbortController();
  readonly #viewers = new Set<(view: HostView) => void>();
  readonly #attached = new Map<Attached, Disposer | null>();
  #state: HostLinkState = { kind: "connecting" };
  #view: HostView | undefined;
  #held: ClientConnection | undefined;
  #waiting: PromiseWithResolvers<ClientConnection> | undefined;
  #wake: (() => void) | undefined;

  constructor(dial: () => Promise<ClientConnection>, changed: (state: HostLinkState) => void) {
    this.#dial = dial;
    this.#changed = changed;
  }

  get state(): HostLinkState {
    return this.#state;
  }

  /** The connection to the host. While the host does not answer, it dials at once and settles with that attempt. */
  connection(): Promise<ClientConnection> {
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

  /** Runs `attached` on the connection the link holds now, when it holds one, and on each one after; what it returns runs when that connection is dropped, or when the returned disposer runs. */
  attach(attached: Attached): Disposer {
    this.#attached.set(attached, this.#held === undefined ? null : attached(this.#held));

    return () => {
      this.#attached.get(attached)?.();
      this.#attached.delete(attached);
    };
  }

  start(): void {
    void this.#follow();
  }

  /** Dials now instead of waiting out the pause, and has a held connection's socket check its host, when something says the host may be back: the machine woke. */
  retry(): void {
    this.#wake?.();
    this.#held?.retry();
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
    const connection = await this.#dial().catch((cause: unknown) => {
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

    for (const attached of this.#attached.keys())
      this.#attached.set(attached, attached(connection));

    const lost = await this.#watch(connection, own).then(
      () => "The Nyte host stopped answering.",
      (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
    );

    this.#held = undefined;

    for (const [attached, detach] of this.#attached) {
      detach?.();
      this.#attached.set(attached, null);
    }

    this.#stop.signal.removeEventListener("abort", close);
    close();

    if (!this.#stop.signal.aborted) this.#set({ kind: "unreachable", message: lost });

    return true;
  }

  async #watch(connection: ClientConnection, own: string): Promise<void> {
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
