import { operationsDigest, sdk } from "@nyte-ai/sdk/client";
import type { Connection } from "@nyte-ai/sdk/client";
import { HOST_PORT_ORIGIN } from "../shared/host-port.ts";
import type { SocketLike } from "../shared/host-port.ts";
import { socketDial, socketFetch } from "./host-socket.ts";

export type HostLinkState =
  | { readonly kind: "connecting" }
  | {
      readonly kind: "connected";
      readonly version: string;
      readonly compatible: boolean;
    }
  | { readonly kind: "unreachable"; readonly message: string };

const RETRY_MS = [250, 500, 1_000, 2_000] as const;

export class HostLink {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly dial: (path: string) => SocketLike;
  readonly #changed: (state: HostLinkState) => void;
  readonly #stop = new AbortController();
  #state: HostLinkState = { kind: "connecting" };

  constructor(socket: string, changed: (state: HostLinkState) => void) {
    this.fetch = socketFetch(socket);
    this.dial = socketDial(socket);
    this.#changed = changed;
  }

  get state(): HostLinkState {
    return this.#state;
  }

  connect(): Promise<Connection> {
    return sdk.connect({
      url: HOST_PORT_ORIGIN,
      credentials: { kind: "custom", headers: () => ({}) },
      fetch: (url, init) => this.fetch(new Request(url, init)),
    });
  }

  start(): void {
    void this.#follow();
  }

  close(): void {
    this.#stop.abort();
  }

  async #follow(): Promise<void> {
    const own = await operationsDigest();
    let failures = 0;

    while (!this.#stop.signal.aborted) {
      try {
        const connection = await this.connect();
        const stop = (): void => void connection.close();
        this.#stop.signal.addEventListener("abort", stop, { once: true });

        try {
          for await (const view of connection.watch()) {
            failures = 0;
            this.#set(
              view.link.kind === "connected"
                ? {
                    kind: "connected",
                    version: view.version,
                    compatible: view.operations === null || view.operations === own,
                  }
                : { kind: "unreachable", message: "The Nyte host stopped answering." },
            );
          }
        } finally {
          this.#stop.signal.removeEventListener("abort", stop);
          await connection.close().catch(() => undefined);
        }
      } catch (cause) {
        if (this.#stop.signal.aborted) return;
        this.#set({
          kind: "unreachable",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }

      failures++;
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]),
      );
    }
  }

  #set(state: HostLinkState): void {
    if (JSON.stringify(state) === JSON.stringify(this.#state)) return;
    this.#state = state;
    this.#changed(state);
  }
}
