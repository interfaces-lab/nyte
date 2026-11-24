import type { HostSocket, SocketEvent } from "@nyte-ai/protocol";
import { OPERATIONS } from "@nyte-ai/schema";
import { CliError } from "./cli/errors.ts";
import type { NextStep } from "./cli/errors.ts";
import { formatCommand, formatNextJson } from "./cli/format.ts";
import { parseCommandArgs } from "./cli/options.ts";
import type { Output } from "./cli/output.ts";
import type { Mode } from "./cli/mode.ts";
import { hostFailure, readHostUrl } from "./host-socket.ts";

const HELP = { next: [{ label: "See the options", argv: ["nyte", "events", "--help"] }] };

const FIRST_RETRY_MS = 1000;

const RETRY_CAP_MS = 30_000;

const GIVE_UP_MS = 5 * 60_000;

const UNITS = new Map([
  ["ms", 1],
  ["s", 1000],
  ["m", 60_000],
  ["h", 3_600_000],
]);

type Parsed = ReturnType<typeof parseEventsArgs>;

export async function eventsCommand(input: {
  readonly args: readonly string[];
  readonly dialer: (hostUrl: string | undefined) => () => Promise<HostSocket>;
  readonly signal: AbortSignal;
  readonly output: Output;
}): Promise<number> {
  const parsed = parseEventsArgs(input.args, input.output.mode);
  const dial = input.dialer(parsed.hostUrl);

  const stop = AbortSignal.any([
    input.signal,
    input.output.closed,
    ...(parsed.timeout === undefined ? [] : [AbortSignal.timeout(parsed.timeout)]),
  ]);

  let hostSeq: number | null = null;

  const print = (event: SocketEvent): void => {
    if (event.scope === "host" && event.kind === "change" && event.seq !== null) {
      hostSeq = event.seq;
    }
    input.output.result(
      `${JSON.stringify(Object.fromEntries(Object.entries(event).filter((entry) => entry[0] !== "c" && entry[0] !== "type")))}\n`,
    );
  };

  const open = (): Promise<HostSocket> => follow(dial, parsed.scopes, print);

  let socket = await open();

  for (;;) {
    const closed = await until(socket.closed, stop);
    socket.close();

    if (closed === undefined) return 0;

    if (!parsed.json) input.output.status("warn", "Lost connection. Retrying automatically…");
    const lostAt = Date.now();
    const back = await reconnect(open, stop);

    if (back === undefined) return 0;
    socket = back;
    warnGap(input.output, parsed, { lostAt, reconnectedAt: Date.now(), hostSeq });
  }
}

async function follow(
  dial: () => Promise<HostSocket>,
  scopes: readonly string[],
  print: (event: SocketEvent) => void,
): Promise<HostSocket> {
  const socket = await dial();
  socket.onEvent(print);

  await socket.call("events.subscribe", { scopes: [...scopes] }).catch((error: unknown) => {
    socket.close();

    return hostFailure(`follow ${scopes.join(", ")}`)(error);
  });

  return socket;
}

async function reconnect(
  open: () => Promise<HostSocket>,
  stop: AbortSignal,
): Promise<HostSocket | undefined> {
  const quit = AbortSignal.any([stop, AbortSignal.timeout(GIVE_UP_MS)]);
  let last: CliError | undefined;
  let attempts = 0;

  while (!quit.aborted) {
    await sleep(Math.min(FIRST_RETRY_MS * 2 ** attempts, RETRY_CAP_MS), quit);

    if (quit.aborted) break;
    attempts += 1;

    const attempt = open().catch((error: unknown) => {
      if (
        !(error instanceof CliError) ||
        (error.reason !== "host_not_running" && error.reason !== "network_error")
      ) {
        throw error;
      }
      last = error;

      return undefined;
    });

    const socket = await until(attempt, quit);

    if (socket !== undefined) return socket;

    if (quit.aborted) {
      void attempt.then(
        (late) => late?.close(),
        () => undefined,
      );
    }
  }

  if (stop.aborted) return undefined;

  throw new CliError("network_error", `Couldn't reconnect to the host in ${spoken(GIVE_UP_MS)}.`, {
    details: [
      { label: "Retries", value: String(attempts) },
      ...(last === undefined
        ? []
        : [{ label: "Last error", value: last.message }, ...last.details]),
    ],
    next: last?.next ?? [],
  });
}

function warnGap(
  output: Output,
  parsed: Parsed,
  gap: { readonly lostAt: number; readonly reconnectedAt: number; readonly hostSeq: number | null },
): void {
  const message = `Reconnected after ${spoken(gap.reconnectedAt - gap.lostAt)}. Events sent in that time were missed.`;
  const next = parsed.scopes.includes("host") ? [sessionsRead(parsed.hostUrl, gap.hostSeq)] : [];

  if (parsed.json) {
    output.say(
      JSON.stringify({
        type: "warning",
        reason: "stream_gap",
        message,
        next: next.length === 0 ? undefined : formatNextJson(next),
        data: { lostAt: gap.lostAt, reconnectedAt: gap.reconnectedAt },
      }),
    );

    return;
  }

  output.status("warn", message);

  for (const step of next) {
    output.say("");
    output.say(`  ${step.label}:`);
    output.say(formatCommand(step.argv, output.mode.stderr));
  }
}

function sessionsRead(hostUrl: string | undefined, seq: number | null): NextStep {
  return {
    label:
      seq === null ? "Read the sessions as they are now" : "Read the sessions changed since then",
    argv: [
      "nyte",
      "api",
      "call",
      "sessions.read",
      JSON.stringify(seq === null ? {} : { resume: { seq } }),
      ...(hostUrl === undefined ? [] : ["--host-url", hostUrl]),
    ],
  };
}

function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);

  return Promise.race([
    promise,
    new Promise<undefined>((stopped) =>
      signal.addEventListener("abort", () => stopped(undefined), { once: true }),
    ),
  ]);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, ms);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        done();
      },
      { once: true },
    );
  });
}

function spoken(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  if (minutes === 0) return `${rest} s`;

  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

function parseEventsArgs(args: readonly string[], mode: Mode) {
  const parsed = parseCommandArgs("events", args, 0);
  const given = parsed.values("scope");
  const scopes = given.length === 0 ? ["host"] : given;
  const subscribe = OPERATIONS["events.subscribe"].input["~standard"];

  const bad = scopes.find((scope) => {
    const result = subscribe.validate({ scopes: [scope] });

    return result instanceof Promise || result.issues !== undefined;
  });

  if (bad !== undefined) {
    throw new CliError(
      "invalid_arguments",
      `Can't follow scope ${bad}. Use host, session/<ID> or client/<ID>.`,
      HELP,
    );
  }

  const timeout = readTimeout(parsed.value("timeout"));

  if (timeout === undefined && mode.ci) {
    throw new CliError("missing_input", "Can't follow events in CI without --timeout.", {
      next: [
        {
          label: "Follow for a set time",
          argv: ["nyte", "events", ...args, "--timeout", "<DURATION>"],
        },
      ],
    });
  }

  return {
    scopes,
    timeout,
    json: parsed.has("json"),
    hostUrl: readHostUrl("events", parsed.value("host-url")),
  };
}

function readTimeout(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const parts = [...text.matchAll(/(\d+)(ms|s|m|h)/gu)];

  const total = parts.reduce(
    (sum, part) => sum + Number(part[1]) * (UNITS.get(part[2] ?? "") ?? 0),
    0,
  );

  if (parts.map((part) => part[0]).join("") !== text || total === 0) {
    throw new CliError(
      "invalid_arguments",
      `Can't read --timeout ${text} as a duration. Use a number and a unit, such as 30s or 10m.`,
      HELP,
    );
  }

  return total;
}
