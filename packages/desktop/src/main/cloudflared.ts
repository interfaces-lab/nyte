/**
 * `cloudflared` as the Cloudflare plugin runs it: one connector for the user's
 * own remotely-managed named tunnel, alive only while remote access serves
 * over it.
 *
 * Nothing the user's environment sets reaches it. It gets a fixed environment
 * with a private `HOME`, an explicit `--config` (which turns off cloudflared's
 * search of `~/.cloudflared` and `/etc/cloudflared`), and explicit flags for
 * log level, metrics address, diagnostics, and updates. The token travels in
 * `TUNNEL_TOKEN`, never in argv.
 *
 * `--loglevel info` keeps request headers, bearer tokens included, out of the
 * local log only. cloudflared hands every event to its management logger
 * whatever the local level, and a live-log session from the Cloudflare
 * dashboard picks its own level, debug included
 * (`logger/create.go`, `resilientMultiWriter`). `--management-diagnostics=false`
 * removes the pprof and metrics routes, not that log stream. Whoever can open
 * the tunnel's live logs in the Cloudflare account can read device tokens.
 *
 * Status comes from cloudflared's JSON log records, read in memory and never
 * forwarded: field and message names are those of cloudflared 2026.8.3
 * (`connection/observer.go`, `connection/control.go`, `supervisor/supervisor.go`,
 * `orchestration/orchestrator.go`). Before the dashboard's configuration
 * arrives cloudflared has no ingress and answers 503, so `connected` waits for
 * that configuration and requires its public-hostname ingress to send only
 * this hostname to this listener.
 *
 * That check cannot cover private network routing. In cloudflared 2026.8.3
 * the pushed `warp-routing` block holds only timeouts and a flow limit (no
 * `enabled` switch, and 0 flows means unlimited); routes to private networks
 * are attached to the tunnel in Cloudflare and never appear in what the
 * connector receives, so neither Nyte nor the connector can see or refuse
 * them. A tunnel used here must have no private network routes.
 *
 * cloudflared runs under a POSIX `sh` supervisor holding the read end of a
 * pipe from this process. Stopping closes the pipe; so does this process
 * dying, even by SIGKILL, and either way the supervisor ends cloudflared.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import type { TunnelConnection, TunnelFailure } from "@nyte-ai/app/bridge.ts";

/** Where macOS and Linux installs put the CLI, in the order to try them. */
const CLOUDFLARED_PATHS = [
  "/opt/homebrew/bin/cloudflared",
  "/usr/local/bin/cloudflared",
  "/usr/bin/cloudflared",
] as const;

/**
 * Runs `"$@"` with stdin from /dev/null and watches its own stdin. End of
 * file there sends SIGTERM, then SIGKILL after five seconds. The watcher uses
 * the `read` builtin so killing it leaves no reader behind.
 */
export const SUPERVISOR_SCRIPT = `exec 3<&0 0</dev/null
"$@" 3<&- &
child=$!
(
  while read -r _ <&3; do :; done
  kill -TERM "$child" 2>/dev/null
  sleep 5
  kill -KILL "$child" 2>/dev/null
) &
watcher=$!
exec 3<&-
wait "$child"
status=$?
kill -KILL "$watcher" 2>/dev/null
exit "$status"
`;

/** Longest stderr line kept; a longer one is dropped whole. */
const LINE_LIMIT = 131_072;

const record = Compile(
  Type.Object(
    {
      message: Type.String(),
      connIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 255 })),
      config: Type.Optional(Type.String()),
    },
    { additionalProperties: true },
  ),
);

/** The origin settings that turn a rule into a proxy to somewhere other than its service. */
const originRequestType = Type.Object(
  {
    bastionMode: Type.Optional(Type.Unknown()),
    proxyAddress: Type.Optional(Type.Unknown()),
    proxyPort: Type.Optional(Type.Unknown()),
    proxyType: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: true },
);

const originRequest = Type.Optional(originRequestType);

function proxies(options: Static<typeof originRequestType> | undefined): boolean {
  return (
    options !== undefined &&
    (options.bastionMode === true ||
      options.proxyAddress !== undefined ||
      options.proxyPort !== undefined ||
      options.proxyType !== undefined)
  );
}

const remoteConfig = Compile(
  Type.Object(
    {
      ingress: Type.Array(
        Type.Object(
          {
            hostname: Type.Optional(Type.String()),
            path: Type.Optional(Type.String()),
            service: Type.Optional(Type.String()),
            originRequest,
          },
          { additionalProperties: true },
        ),
      ),
      originRequest,
    },
    { additionalProperties: true },
  ),
);

export interface ConnectorTiming {
  /** Delay before each restart after an unexpected exit; its length is the retry limit. */
  readonly retryDelaysMs: readonly number[];
  /** How long after the first connection the dashboard's configuration may take. */
  readonly ingressTimeoutMs: number;
  /** Connected this long, the retry count starts over. */
  readonly stableMs: number;
  /** After closing the supervisor's pipe, how long before its process group is killed. */
  readonly stopTimeoutMs: number;
}

/** After the process group is killed, how long a stop still waits for the exit event. */
const KILL_GRACE_MS = 2_000;

/** How long a run's leftover process group may take to empty after SIGKILL. */
const REAP_LIMIT_MS = 1_000;

/**
 * SIGKILL what is left of a run's process group (the supervisor led it, so
 * its pid is the group id) and wait until the group is empty. The id cannot
 * be reused while the group has members, so the polling never reaches an
 * unrelated process; the first kill runs as the supervisor's exit is
 * reported, before its id could have been handed out again.
 */
async function reap(pid: number | undefined): Promise<void> {
  if (pid === undefined) return;

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    return;
  }

  for (let waited = 0; waited < REAP_LIMIT_MS; waited += 10) {
    try {
      process.kill(-pid, 0);
    } catch {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const DEFAULT_TIMING: ConnectorTiming = {
  retryDelaysMs: [1_000, 5_000, 30_000],
  ingressTimeoutMs: 20_000,
  stableMs: 600_000,
  stopTimeoutMs: 8_000,
};

export interface ConnectorOptions {
  readonly executable: string;
  readonly tunnelToken: string;
  readonly hostname: string;
  readonly port: number;
  /** cloudflared's private `HOME`, holding the config file Nyte writes. */
  readonly directory: string;
  readonly onChange: () => void;
  readonly timing?: ConnectorTiming;
}

interface Run {
  readonly child: ChildProcess;
  readonly connections: Set<number>;
  ingress: "pending" | "verified";
  ingressTimer: ReturnType<typeof setTimeout> | undefined;
  exited: boolean;
  /** Set once this process asked the run to end, so its exit is not a crash. */
  ending: boolean;
  readonly done: Promise<void>;
}

/** The first install path holding an executable `cloudflared`, if any. */
export async function findCloudflared(): Promise<string | undefined> {
  if (process.platform === "win32") return undefined;

  for (const path of CLOUDFLARED_PATHS) {
    try {
      await access(path, constants.X_OK);

      return path;
    } catch {
      // Not here; try the next one.
    }
  }

  return undefined;
}

function configPath(directory: string): string {
  return join(directory, "config.yml");
}

/** The private `HOME` and the config file `--config` names, so no other config file is read. */
export async function prepareConnectorDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    configPath(directory),
    [
      "no-autoupdate: true",
      "loglevel: info",
      "transport-loglevel: warn",
      "output: json",
      "metrics: 127.0.0.1:0",
      "management-diagnostics: false",
      "grace-period: 2s",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
}

export function connectorArguments(directory: string): readonly string[] {
  return [
    "tunnel",
    "--config",
    configPath(directory),
    "--no-autoupdate",
    "--output",
    "json",
    "--loglevel",
    "info",
    "--transport-loglevel",
    "warn",
    "--metrics",
    "127.0.0.1:0",
    "--management-diagnostics=false",
    "--grace-period",
    "2s",
    "run",
  ];
}

/**
 * Public-hostname ingress that sends this hostname to this listener and
 * everything else to a status code. Private network routes are outside it.
 */
export function routesOnlyTo(config: string, hostname: string, port: number): boolean {
  let parsed: unknown;

  try {
    parsed = JSON.parse(config);
  } catch {
    return false;
  }

  if (!remoteConfig.Check(parsed) || proxies(parsed.originRequest)) return false;

  const [route, fallback, ...rest] = parsed.ingress;

  if (route === undefined || fallback === undefined || rest.length > 0) return false;

  return (
    route.hostname?.toLowerCase() === hostname &&
    (route.path ?? "") === "" &&
    route.service === `http://127.0.0.1:${String(port)}` &&
    !proxies(route.originRequest) &&
    (fallback.hostname ?? "") === "" &&
    (fallback.path ?? "") === "" &&
    /^http_status:\d{3}$/u.test(fallback.service ?? "") &&
    !proxies(fallback.originRequest)
  );
}

/** One connector's life: started once, stopped once. */
export class CloudflaredConnector {
  private readonly options: ConnectorOptions;
  private readonly timing: ConnectorTiming;
  private run: Run | undefined;
  private started = false;
  private stopped = false;
  private failure: TunnelFailure | undefined;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stableTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ConnectorOptions) {
    this.options = options;
    this.timing = options.timing ?? DEFAULT_TIMING;
  }

  status(): TunnelConnection {
    if (this.failure !== undefined) return { kind: "failed", reason: this.failure };

    if (!this.started || this.stopped) return { kind: "stopped" };

    if (this.retryTimer !== undefined) return { kind: "retrying", attempt: this.attempts };
    const run = this.run;

    if (run !== undefined && run.ingress === "verified" && run.connections.size > 0) {
      return { kind: "connected", connections: run.connections.size };
    }

    return { kind: "connecting" };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.spawn();
  }

  /** Resolves once cloudflared and its supervisor are gone, or after the kill deadline. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    clearTimeout(this.stableTimer);
    const run = this.run;

    if (run !== undefined) await this.end(run);
  }

  private spawn(): void {
    const { directory } = this.options;

    const child = spawn(
      "/bin/sh",
      [
        "-c",
        SUPERVISOR_SCRIPT,
        "nyte-cloudflared",
        this.options.executable,
        ...connectorArguments(directory),
      ],
      {
        // Its own process group, so a stuck stop can kill the supervisor and cloudflared together.
        detached: true,
        stdio: ["pipe", "ignore", "pipe"],
        env: {
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          HOME: directory,
          TUNNEL_TOKEN: this.options.tunnelToken,
        },
      },
    );

    const exited = Promise.withResolvers<void>();

    const run: Run = {
      child,
      connections: new Set(),
      ingress: "pending",
      ingressTimer: undefined,
      exited: false,
      ending: false,
      done: exited.promise,
    };

    this.run = run;

    let buffered = "";
    let dropping = false;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      let rest = chunk;

      for (;;) {
        const newline = rest.indexOf("\n");

        if (newline < 0) {
          if (!dropping) buffered += rest;

          if (buffered.length > LINE_LIMIT) {
            buffered = "";
            dropping = true;
          }

          return;
        }

        const line = dropping ? "" : buffered + rest.slice(0, newline);
        buffered = "";
        dropping = false;
        rest = rest.slice(newline + 1);

        if (line !== "") this.read(run, line);
      }
    });

    let settled = false;

    // The supervisor can exit before cloudflared does (it was killed on its
    // own), so the run is over only once its whole process group is gone.
    const finish = (): void => {
      if (settled) return;
      settled = true;
      child.stdin?.destroy();
      void reap(child.pid).then(() => {
        run.exited = true;
        exited.resolve();
        this.exited(run);
      });
    };

    child.once("exit", finish);
    child.once("error", finish);
    // A write after the supervisor is gone must not throw into this process.
    child.stdin?.on("error", () => undefined);
  }

  private read(run: Run, line: string): void {
    if (this.run !== run || run.ending) return;
    let value: unknown;

    try {
      value = JSON.parse(line);
    } catch {
      return;
    }

    if (!record.Check(value)) return;

    switch (value.message) {
      case "Registered tunnel connection":
        if (value.connIndex !== undefined) run.connections.add(value.connIndex);
        break;
      case "Unregistered tunnel connection":
      case "Connection terminated":
        if (value.connIndex !== undefined) run.connections.delete(value.connIndex);
        break;
      case "Updated to new configuration":
        if (
          value.config === undefined ||
          !routesOnlyTo(value.config, this.options.hostname, this.options.port)
        ) {
          this.fail(run, "ingress_mismatch");

          return;
        }

        run.ingress = "verified";
        clearTimeout(run.ingressTimer);
        break;
      default:
        return;
    }

    if (run.ingress === "pending" && run.connections.size > 0 && run.ingressTimer === undefined) {
      run.ingressTimer = setTimeout(
        () => this.fail(run, "ingress_unverified"),
        this.timing.ingressTimeoutMs,
      );
    }

    // Only an unbroken connected stretch earns back the retries.
    if (this.status().kind !== "connected") {
      clearTimeout(this.stableTimer);
      this.stableTimer = undefined;
    } else if (this.stableTimer === undefined) {
      this.stableTimer = setTimeout(() => {
        this.attempts = 0;
      }, this.timing.stableMs);
    }

    this.options.onChange();
  }

  /** A policy failure ends the run and never retries. */
  private fail(run: Run, reason: TunnelFailure): void {
    if (this.run !== run || run.ending) return;
    this.failure = reason;
    void this.end(run);
    this.options.onChange();
  }

  private exited(run: Run): void {
    clearTimeout(run.ingressTimer);
    run.connections.clear();
    clearTimeout(this.stableTimer);
    this.stableTimer = undefined;

    if (this.run !== run) return;

    if (run.ending || this.stopped || this.failure !== undefined) {
      this.options.onChange();

      return;
    }

    const delay = this.timing.retryDelaysMs[this.attempts];

    if (delay === undefined) {
      this.failure = "exited";
    } else {
      this.attempts += 1;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;

        if (!this.stopped) this.spawn();
        this.options.onChange();
      }, delay);
    }

    this.options.onChange();
  }

  /** Close the supervisor's pipe; kill its process group if it outlives the deadline. */
  private async end(run: Run): Promise<void> {
    run.ending = true;
    clearTimeout(run.ingressTimer);

    if (run.exited) return;
    run.child.stdin?.destroy();

    const deadline = setTimeout(() => {
      const { pid } = run.child;

      if (run.exited || pid === undefined) return;

      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, this.timing.stopTimeoutMs);

    const abandon = Promise.withResolvers<void>();
    const giveUp = setTimeout(abandon.resolve, this.timing.stopTimeoutMs + KILL_GRACE_MS);

    try {
      await Promise.race([run.done, abandon.promise]);
    } finally {
      clearTimeout(deadline);
      clearTimeout(giveUp);
    }
  }
}
