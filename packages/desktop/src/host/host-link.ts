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

const RETRY_MS = [100, 250, 500, 1000] as const;

type Attached = (connection: ClientConnection) => Disposer;

export class HostLink {
  private readonly dial: () => Promise<ClientConnection>;
  private readonly changed: (state: HostLinkState) => void;
  private readonly stop = new AbortController();
  private readonly viewers = new Set<(view: HostView) => void>();
  private readonly attached = new Map<Attached, Disposer | null>();
  private current: HostLinkState = { kind: "connecting" };
  private view: HostView | undefined;
  private held: ClientConnection | undefined;
  private waiting: PromiseWithResolvers<ClientConnection> | undefined;
  private wake: (() => void) | undefined;

  constructor(dial: () => Promise<ClientConnection>, changed: (state: HostLinkState) => void) {
    this.dial = dial;
    this.changed = changed;
  }

  get state(): HostLinkState {
    return this.current;
  }

  connection(): Promise<ClientConnection> {
    if (this.stop.signal.aborted) {
      return Promise.reject(new SdkError("unavailable", "The desktop's host link is closed."));
    }

    if (this.held !== undefined) return Promise.resolve(this.held);
    this.waiting ??= Promise.withResolvers();
    this.wake?.();

    return this.waiting.promise;
  }

  follow(viewer: (view: HostView) => void): Disposer {
    this.viewers.add(viewer);

    if (this.view !== undefined) this.show(viewer, this.view);

    return () => {
      this.viewers.delete(viewer);
    };
  }

  attach(attached: Attached): Disposer {
    this.attached.set(attached, this.held === undefined ? null : attached(this.held));

    return () => {
      this.attached.get(attached)?.();
      this.attached.delete(attached);
    };
  }

  start(): void {
    void this.followConnection();
  }

  retry(): void {
    this.wake?.();
    this.held?.retry();
  }

  close(): void {
    this.stop.abort();
    this.waiting?.reject(new SdkError("unavailable", "The desktop's host link is closed."));
    this.waiting = undefined;
  }

  private async followConnection(): Promise<void> {
    const own = await operationsDigest();
    let failures = 0;

    while (!this.stop.signal.aborted) {
      failures = (await this.hold(own)) ? 0 : failures + 1;
      await this.pause(RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
    }
  }

  private async hold(own: string): Promise<boolean> {
    const connection = await this.dial().catch((cause: unknown) => {
      this.unreachable(cause instanceof Error ? cause.message : String(cause), cause);

      return undefined;
    });

    if (connection === undefined) return false;
    const close = (): void => void connection.close().catch(() => undefined);

    if (this.stop.signal.aborted) {
      close();

      return true;
    }

    this.stop.signal.addEventListener("abort", close, { once: true });
    this.held = connection;
    this.waiting?.resolve(connection);
    this.waiting = undefined;

    for (const attached of this.attached.keys()) {
      this.attached.set(attached, attached(connection));
    }

    const lost = await this.watch(connection, own).then(
      () => "The Nyte host stopped answering.",
      (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
    );

    this.held = undefined;

    for (const [attached, detach] of this.attached) {
      detach?.();
      this.attached.set(attached, null);
    }

    this.stop.signal.removeEventListener("abort", close);
    close();

    if (!this.stop.signal.aborted) this.set({ kind: "unreachable", message: lost });

    return true;
  }

  private async watch(connection: ClientConnection, own: string): Promise<void> {
    for await (const view of connection.watch()) {
      if (view.link.kind !== "connected" || this.stop.signal.aborted) return;
      this.view = view;
      this.set({
        kind: "connected",
        version: view.version,
        compatible: view.operations === null || view.operations === own,
      });

      for (const viewer of this.viewers) this.show(viewer, view);
    }
  }

  private show(viewer: (view: HostView) => void, view: HostView): void {
    try {
      viewer(view);
    } catch (cause) {
      retainDiagnostic({ correlationId: "desktop-host-view", cause });
    }
  }

  private unreachable(message: string, cause: unknown): void {
    this.waiting?.reject(cause);
    this.waiting = undefined;

    if (!this.stop.signal.aborted) this.set({ kind: "unreachable", message });
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.stop.signal.removeEventListener("abort", done);
        this.wake = undefined;
        resolve();
      };

      const timer = setTimeout(done, ms);
      this.stop.signal.addEventListener("abort", done, { once: true });
      this.wake = done;
    });
  }

  private set(state: HostLinkState): void {
    if (JSON.stringify(state) === JSON.stringify(this.current)) return;
    this.current = state;
    this.changed(state);
  }
}
