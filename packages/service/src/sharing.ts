import { join } from "node:path";
import { tryLockFile } from "@nyte-ai/connect/host";
import type { ConnectRuntime, ConnectShare } from "@nyte-ai/connect/host";
import { SERVICE_ROUTES, serviceRoutes } from "./routes.ts";
import type { ServiceEvent } from "./routes.ts";

export const RELAY_ELECT_MS = 5_000;

export type SharedConnect = Pick<
  ConnectRuntime,
  "view" | "link" | "setEnabled" | "autostart" | "stop" | "unlink" | "retryUnlinks"
>;

export class Sharing {
  readonly #connect: SharedConnect;
  readonly #share: ConnectShare;
  readonly #lock: string;
  readonly #streams = new Set<(event: ServiceEvent) => void>();
  #release: (() => void) | null = null;
  #timer: ReturnType<typeof setInterval> | undefined;
  #electing = false;
  #closed = false;

  constructor(input: {
    readonly connect: SharedConnect;
    readonly share: ConnectShare;
    readonly home: string;
  }) {
    this.#connect = input.connect;
    this.#share = input.share;
    this.#lock = join(input.home, ".nyte", "relay.lock");
  }

  get holder(): boolean {
    return this.#release !== null;
  }

  start(): void {
    if (this.#timer !== undefined || this.#closed) return;
    void this.#connect.retryUnlinks().catch(() => undefined);
    void this.#elect();
    this.#timer = setInterval(() => void this.#elect(), RELAY_ELECT_MS);
  }

  changed(): void {
    if (this.#streams.size === 0) return;
    void this.#connect.view().then((view) => this.#emit({ kind: "view", view }));
  }

  claim(): boolean {
    if (this.#closed) return false;

    if (this.#release === null) {
      this.#release = tryLockFile(this.#lock);

      if (this.#release !== null) this.#emit({ kind: "relay", holder: true });
    }

    return this.#release !== null;
  }

  routes(token: string): (request: Request) => Response | Promise<Response> | undefined {
    return serviceRoutes(token, (request, pathname) => this.#route(request, pathname));
  }

  async link(): Promise<void> {
    const before = await this.#connect.view();

    if (before.kind === "unavailable") return;
    const after = before.kind === "unlinked" ? await this.#connect.link() : before;

    if (after.kind === "unlinked" && after.linking.kind === "failed")
      this.#emit({ kind: "link_failed", reason: after.linking.reason });

    if (after.kind !== "linked") return;

    if (!after.enabled)
      await this.#connect
        .setEnabled({ enabled: true, share: this.claim() ? this.#share : null })
        .catch((cause: unknown) => this.#emit({ kind: "error", message: describeError(cause) }));
    await this.#elect();
  }

  async close(): Promise<void> {
    this.#closed = true;
    clearInterval(this.#timer);
    this.#streams.clear();
    await this.#stepDown();
  }

  async #stepDown(): Promise<void> {
    if (this.#release === null) return;
    await this.#connect.stop().catch(() => undefined);
    this.#release();
    this.#release = null;
    this.#emit({ kind: "relay", holder: false });
  }

  async #elect(): Promise<void> {
    if (this.#electing || this.#closed) return;
    this.#electing = true;

    try {
      const view = await this.#connect.view();

      if (view.kind !== "linked" || !view.enabled) {
        await this.#stepDown();

        return;
      }

      if (this.claim()) await this.#connect.autostart(this.#share);
    } catch (cause) {
      this.#emit({ kind: "error", message: describeError(cause) });
    } finally {
      this.#electing = false;
    }
  }

  async #route(request: Request, pathname: string): Promise<Response> {
    if (request.method === "GET" && pathname === SERVICE_ROUTES.connect)
      return Response.json(await this.#connect.view());

    if (request.method === "GET" && pathname === SERVICE_ROUTES.watch) return this.#stream(false);

    if (request.method === "GET" && pathname === SERVICE_ROUTES.share) return this.#stream(true);

    if (request.method === "POST" && pathname === SERVICE_ROUTES.unlink) {
      try {
        await this.#connect.unlink();
      } catch (cause) {
        return Response.json({ message: describeError(cause) }, { status: 409 });
      }

      return Response.json(await this.#connect.view());
    }

    return Response.json({ message: "Not found" }, { status: 404 });
  }

  #stream(link: boolean): Response {
    const encoder = new TextEncoder();
    let send: ((event: ServiceEvent) => void) | undefined;

    const body = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        let last = "";

        send = (event) => {
          const line = JSON.stringify(event);

          if (line === last) return;
          last = line;
          controller.enqueue(encoder.encode(`${line}\n`));
        };

        this.#streams.add(send);
        send({ kind: "relay", holder: this.holder });
        send({ kind: "view", view: await this.#connect.view() });

        if (link) void this.link();
      },
      cancel: () => {
        if (send !== undefined) this.#streams.delete(send);
      },
    });

    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
    });
  }

  #emit(event: ServiceEvent): void {
    for (const send of this.#streams) send(event);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
