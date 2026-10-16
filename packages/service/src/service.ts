import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import process from "node:process";
import { ConnectRuntime, hostShare, machineName } from "@nyte-ai/connect/host";
import type { ConnectShare, HostConnectConfig } from "@nyte-ai/connect/host";
import type { Host, Listener } from "@nyte-ai/sdk";
import { Value } from "typebox/value";
import { serviceBuild } from "./build.ts";
import { IDLE_GRACE_MS, Lifetime, REAL_TIMERS, terminate } from "./lifetime.ts";
import type { LifetimeOptions } from "./lifetime.ts";
import { portConflict, probePort, SERVICE_HOSTNAME } from "./port.ts";
import { acquireLock, removeRegistration, writeRegistration } from "./registration.ts";
import type { Registration } from "./registration.ts";
import { AttachmentSchema, SERVICE_ROUTES } from "./routes.ts";
import type { ServiceEvent } from "./routes.ts";

export interface StartServiceOptions {
  readonly open: () => Promise<Host>;
  readonly home: string;
  readonly port: number;
  readonly version: string;
  readonly connect: HostConnectConfig | undefined;
  /** When the service stops on its own; by default `IDLE_GRACE_MS`, real timers, and `terminate`. */
  readonly lifetime?: Partial<LifetimeOptions>;
}

export interface RunningService {
  readonly registration: Registration;
  close(): Promise<void>;
}

export class PortInUse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortInUse";
  }
}

export class ServiceRunning extends Error {
  readonly pid: number;

  constructor(pid: number) {
    super(`The Nyte service is already running (pid ${String(pid)}).`);
    this.name = "ServiceRunning";
    this.pid = pid;
  }
}

export async function startService(options: StartServiceOptions): Promise<RunningService> {
  const { home, port } = options;
  const lock = await acquireLock(home, process.pid);

  if (lock.kind === "held") throw new ServiceRunning(lock.pid);
  const host = await options.open().catch(async (cause: unknown) => {
    await lock.release();

    throw cause;
  });
  const token = randomBytes(32).toString("base64url");
  const digest = sha256(`Bearer ${token}`);

  const connect = new ConnectRuntime({
    config: options.connect,
    home: join(home, ".nyte"),
    authorizer: { kind: "transaction", onOpened: () => undefined },
    onChange: () => sharing.changed(),
    name: machineName(),
  });

  const sharing = new Sharing(connect, hostShare(host));

  const lifetime = new Lifetime(
    { grace: IDLE_GRACE_MS, timers: REAL_TIMERS, idle: terminate, ...options.lifetime },
    () => working(host),
  );

  let listener: Listener | undefined;

  try {
    listener = await host
      .listen({
        transport: { kind: "http", hostname: SERVICE_HOSTNAME, port },
        auth: { kind: "token", token },
        before: (request) => {
          const { pathname } = new URL(request.url);

          if (!pathname.startsWith(SERVICE_ROUTES.prefix)) return undefined;

          const presented = request.headers.get("authorization");

          if (presented === null || !timingSafeEqual(sha256(presented), digest))
            return Response.json({ message: "Unauthorized" }, { status: 401 });

          return route(request, pathname, connect, sharing, lifetime);
        },
      })
      .catch(async (cause: unknown) => {
        const held = port === 0 ? undefined : portConflict(port, await probePort(port));

        throw held === undefined ? cause : new PortInUse(held);
      });

    if (listener.address === null) throw new Error("The service listener bound no address.");

    const registration: Registration = {
      url: listener.address,
      token,
      pid: process.pid,
      version: await serviceBuild(options.version),
      hostId: host.hostId,
    };

    await writeRegistration(home, registration);
    const opened = listener;
    let closing: Promise<void> | undefined;

    return {
      registration,
      close() {
        closing ??= (async () => {
          await removeRegistration(home, registration.pid);
          lifetime.close();
          sharing.close();
          await connect.close();
          await opened.close();
          await host.close();
          await lock.release();
        })();

        return closing;
      },
    };
  } catch (cause) {
    await listener?.close();
    lifetime.close();
    sharing.close();
    await connect.close();
    await host.close();
    await lock.release();

    throw cause;
  }
}

async function route(
  request: Request,
  pathname: string,
  connect: ConnectRuntime,
  sharing: Sharing,
  lifetime: Lifetime,
): Promise<Response> {
  if (request.method === "GET" && pathname === SERVICE_ROUTES.attach) {
    const query = new URL(request.url).searchParams;

    const attachment = {
      pid: Number(query.get("pid")),
      startedAt: Number(query.get("startedAt")),
      build: query.get("build"),
    };

    return Value.Check(AttachmentSchema, attachment)
      ? lifetime.attach(attachment, request.signal)
      : Response.json(
          { message: "An attachment names its pid, start and build." },
          { status: 400 },
        );
  }

  if (request.method === "GET" && pathname === SERVICE_ROUTES.clients)
    return Response.json(await lifetime.clients());

  if (request.method === "GET" && pathname === SERVICE_ROUTES.connect)
    return Response.json(await connect.view());

  if (request.method === "GET" && pathname === SERVICE_ROUTES.watch)
    return sharing.stream({ hold: false });

  if (request.method === "GET" && pathname === SERVICE_ROUTES.share)
    return sharing.stream({ hold: true });

  if (request.method === "POST" && pathname === SERVICE_ROUTES.unlink) {
    try {
      await connect.unlink();
    } catch (cause) {
      return Response.json({ message: describeError(cause) }, { status: 409 });
    }

    return Response.json(await connect.view());
  }

  return Response.json({ message: "Not found" }, { status: 404 });
}

class Sharing {
  readonly #connect: ConnectRuntime;
  readonly #share: ConnectShare;
  readonly #streams = new Set<(event: ServiceEvent) => void>();
  #holders = 0;
  #closed = false;

  constructor(connect: ConnectRuntime, share: ConnectShare) {
    this.#connect = connect;
    this.#share = share;
  }

  changed(): void {
    if (this.#streams.size === 0) return;
    void this.#connect.view().then((view) => this.#emit({ kind: "view", view }));
  }

  stream(input: { readonly hold: boolean }): Response {
    const encoder = new TextEncoder();
    let release: (() => void) | undefined;
    let send: ((event: ServiceEvent) => void) | undefined;
    let cancelled = false;

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
        send({ kind: "view", view: await this.#connect.view() });

        if (input.hold && !cancelled) release = this.#hold();
      },
      cancel: () => {
        cancelled = true;

        if (send !== undefined) this.#streams.delete(send);
        release?.();
      },
    });

    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
    });
  }

  close(): void {
    this.#closed = true;
    this.#streams.clear();
    this.#holders = 0;
  }

  #emit(event: ServiceEvent): void {
    for (const send of this.#streams) send(event);
  }

  #hold(): () => void {
    this.#holders += 1;

    if (this.#holders === 1) void this.#start();
    let released = false;

    return () => {
      if (released) return;
      released = true;
      this.#holders -= 1;

      if (this.#holders === 0 && !this.#closed) void this.#stop();
    };
  }

  async #start(): Promise<void> {
    try {
      const before = await this.#connect.view();

      if (before.kind === "unavailable") return;

      if (before.kind === "unlinked") {
        const after = await this.#connect.link();

        if (after.kind === "unlinked" && after.linking.kind === "failed")
          this.#emit({ kind: "link_failed", reason: after.linking.reason });

        if (after.kind !== "linked") return;
      }

      if (this.#holders === 0 || this.#closed) return;
      await this.#connect.serve(this.#share);
    } catch (cause) {
      this.#emit({ kind: "error", message: describeError(cause) });
    }
  }

  async #stop(): Promise<void> {
    try {
      await this.#connect.cancel();
      await this.#connect.stop();
    } catch (cause) {
      this.#emit({ kind: "error", message: describeError(cause) });
    }
  }
}

/** Whether the host has work an idle stop would interrupt: a job (pty or not) still running, or a run driving or retrying in any session. A run waiting on an answer is durable and resumes in the next service. */
async function working(host: Host): Promise<boolean> {
  for (const workspace of await host.workspaces.list()) {
    const jobs = await host.workspace(workspace.id).jobs.list();

    if (jobs.some((job) => job.state.kind === "running")) return true;
  }

  const parents = { kind: "all" } as const;
  let page = await host.sessions.list({ parents });

  for (;;) {
    const driving = page.items.some((session) =>
      session.heads.some(
        (head) => head.execution.kind === "live" || head.execution.kind === "retrying",
      ),
    );

    if (driving) return true;

    if (page.next === null) return false;
    page = await host.sessions.list({ parents, cursor: page.next });
  }
}

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
