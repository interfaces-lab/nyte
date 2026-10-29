import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import type { TunnelConnection, TunnelFailure } from "@nyte-ai/app/bridge.ts";

const CLOUDFLARED_PATHS = [
  "/opt/homebrew/bin/cloudflared",
  "/usr/local/bin/cloudflared",
  "/usr/bin/cloudflared",
] as const;

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
  readonly retryDelaysMs: readonly number[];
  readonly ingressTimeoutMs: number;
  readonly stableMs: number;
  readonly stopTimeoutMs: number;
}

const KILL_GRACE_MS = 2_000;

const REAP_LIMIT_MS = 1_000;

async function reap(pid: number | undefined): Promise<void> {
  if (pid === undefined || !signalGroup(pid, "SIGKILL")) return;

  for (let waited = 0; waited < REAP_LIMIT_MS; waited += 10) {
    if (!signalGroup(pid, 0)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);

    return true;
  } catch {
    return false;
  }
}

const DEFAULT_TIMING: ConnectorTiming = {
  retryDelaysMs: [1_000, 5_000, 30_000],
  ingressTimeoutMs: 20_000,
  stableMs: 600_000,
  stopTimeoutMs: 8_000,
};

interface ConnectorOptions {
  readonly executable: string;
  readonly tunnelToken: string;
  readonly hostname: string;
  readonly port: number;
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
  ending: boolean;
  readonly done: Promise<void>;
}

export async function findCloudflared(): Promise<string | undefined> {
  if (process.platform === "win32") return undefined;

  for (const path of CLOUDFLARED_PATHS) {
    const executable = await access(path, constants.X_OK).then(
      () => true,
      () => false,
    );

    if (executable) return path;
  }

  return undefined;
}

function configPath(directory: string): string {
  return join(directory, "config.yml");
}

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

function connectorArguments(directory: string): readonly string[] {
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
      const lines = chunk.split("\n");
      const tail = lines.pop() ?? "";

      for (const piece of lines) {
        const line = dropping ? "" : buffered + piece;
        buffered = "";
        dropping = false;

        if (line !== "") this.read(run, line);
      }

      if (!dropping) buffered += tail;

      if (buffered.length > LINE_LIMIT) {
        buffered = "";
        dropping = true;
      }
    });

    let settled = false;

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

  private async end(run: Run): Promise<void> {
    run.ending = true;
    clearTimeout(run.ingressTimer);

    if (run.exited) return;
    run.child.stdin?.destroy();

    const deadline = setTimeout(() => {
      const { pid } = run.child;

      if (run.exited || pid === undefined) return;

      signalGroup(pid, "SIGKILL");
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
