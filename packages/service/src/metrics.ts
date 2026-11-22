import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { nyteProviders } from "@nyte-ai/ai";
import { dev } from "@nyte-ai/core";
import type { Plugin, SettingDefinition } from "@nyte-ai/core";
import type { Host } from "@nyte-ai/sdk";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { hostMetricsPath } from "./host-endpoint.ts";

declare const NYTE_BUILT_METRICS_ORIGIN: string | undefined;

declare const NYTE_BUILT_VERSION: string | undefined;

const ORIGIN = typeof NYTE_BUILT_METRICS_ORIGIN === "string" ? NYTE_BUILT_METRICS_ORIGIN : "";

const VERSION = typeof NYTE_BUILT_VERSION === "string" ? NYTE_BUILT_VERSION : "";

const countInstalls = {
  id: "metrics.countInstalls",
  title: "Count installs",
  description: "When Nyte is installed or updated, send its version, system and chip type",
  type: "switch",
  default: true,
} satisfies SettingDefinition;

const shareUsage = {
  id: "metrics.shareUsage",
  title: "Share usage statistics",
  description: "Once a day, send request and token counts for each provider and model",
  type: "switch",
  default: false,
} satisfies SettingDefinition;

const TallyType = Type.Object({
  provider: Type.String(),
  model: Type.String(),
  requests: Type.Integer({ minimum: 0 }),
  input: Type.Integer({ minimum: 0 }),
  output: Type.Integer({ minimum: 0 }),
  cacheRead: Type.Integer({ minimum: 0 }),
  cacheWrite: Type.Integer({ minimum: 0 }),
  cost: Type.Number({ minimum: 0 }),
});

const LedgerType = Type.Object({ day: Type.String(), models: Type.Array(TallyType) });

type Tally = Static<typeof TallyType>;

type Ledger = Static<typeof LedgerType>;

type Report = ReturnType<typeof build> &
  (
    | { readonly kind: "install" | "update" }
    | { readonly day: string; readonly models: readonly Tally[] }
  );

const MODEL_ID = /^[A-Za-z0-9._:/-]{1,100}$/u;

const MAX_MODELS = 100;

export async function reportInstall(host: Host, client: string): Promise<void> {
  if (!sending()) return;
  const view = await firstView(host);
  const enabled = view.settings.find((setting) => setting.id === countInstalls.id)?.value;

  if (enabled === false) return;

  const path = join(hostMetricsPath(), "installed");

  const previous = await readFile(path, "utf8").then(
    (text) => text.trim(),
    () => null,
  );

  if (previous === VERSION) return;
  await post("/v1/install", { kind: previous === null ? "install" : "update", ...build(client) });
  await writeAtomically(path, `${VERSION}\n`);
}

export function metricsPlugin(client: string): Plugin<"core"> {
  return {
    id: "metrics",
    contribute: { settings: [countInstalls, shareUsage] },
    activate(api) {
      let enabled = false;

      void (async () => {
        for await (const value of api.registries.settings.watch(shareUsage.id)) {
          enabled = value === true;
          queue(() => (enabled ? sendFinishedDay(client) : discard()));
        }
      })();

      return {
        hooks: {
          after_request(event) {
            if (!enabled || !sending()) return;

            queue(() =>
              record(client, {
                ...publicModel(event.model.provider, event.model.id),
                requests: 1,
                input: event.usage.input,
                output: event.usage.output,
                cacheRead: event.usage.cacheRead,
                cacheWrite: event.usage.cacheWrite,
                cost: event.usage.cost.total,
              }),
            );
          },
        },
      };
    },
  };
}

let pending: Promise<void> = Promise.resolve();

let ledger: Ledger | null = null;

let shipped: ReadonlySet<string> | null = null;

function queue(task: () => Promise<void>): void {
  pending = pending
    .then(task)
    .catch((cause: unknown) => dev("metrics", "usage", { error: String(cause) }));
}

async function record(client: string, tally: Tally): Promise<void> {
  await sendFinishedDay(client);

  const current = ledger ?? (await loadLedger()) ?? { day: today(), models: [] };

  const known = current.models.find(
    (entry) => entry.provider === tally.provider && entry.model === tally.model,
  );

  if (known === undefined && current.models.length >= MAX_MODELS) return;

  const models =
    known === undefined
      ? [...current.models, rounded(tally)]
      : current.models.map((entry) => (entry === known ? add(entry, tally) : entry));

  ledger = { day: current.day, models };
  await writeAtomically(ledgerPath(), JSON.stringify(ledger));
}

async function sendFinishedDay(client: string): Promise<void> {
  const current = ledger ?? (await loadLedger());

  if (current === null || current.day === today()) return;
  ledger = { day: today(), models: [] };
  await rm(ledgerPath(), { force: true });

  if (current.models.length === 0) return;
  await post("/v1/usage", { day: current.day, ...build(client), models: current.models });
}

async function discard(): Promise<void> {
  ledger = null;
  await rm(ledgerPath(), { force: true });
}

async function loadLedger(): Promise<Ledger | null> {
  return readFile(ledgerPath(), "utf8")
    .then((text) => Value.Parse(LedgerType, JSON.parse(text)))
    .catch(() => null);
}

function publicModel(provider: string, model: string): Pick<Tally, "provider" | "model"> {
  shipped ??= new Set(nyteProviders().map((entry) => entry.id));

  if (!shipped.has(provider)) return { provider: "other", model: "other" };

  return { provider, model: MODEL_ID.test(model) ? model : "other" };
}

function add(entry: Tally, tally: Tally): Tally {
  const sum = rounded(tally);

  return {
    provider: entry.provider,
    model: entry.model,
    requests: entry.requests + sum.requests,
    input: entry.input + sum.input,
    output: entry.output + sum.output,
    cacheRead: entry.cacheRead + sum.cacheRead,
    cacheWrite: entry.cacheWrite + sum.cacheWrite,
    cost: entry.cost + sum.cost,
  };
}

function rounded(tally: Tally): Tally {
  const count = (value: number): number =>
    Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

  return {
    provider: tally.provider,
    model: tally.model,
    requests: count(tally.requests),
    input: count(tally.input),
    output: count(tally.output),
    cacheRead: count(tally.cacheRead),
    cacheWrite: count(tally.cacheWrite),
    cost: Number.isFinite(tally.cost) && tally.cost > 0 ? tally.cost : 0,
  };
}

function sending(): boolean {
  if (ORIGIN === "" || VERSION === "") return false;

  if (process.env["NYTE_OFFLINE"] !== undefined) return false;

  if (process.env["DO_NOT_TRACK"] === "1") return false;

  return !["0", "false", "no", "off"].includes(
    (process.env["NYTE_TELEMETRY"] ?? "").trim().toLowerCase(),
  );
}

function build(client: string) {
  return {
    version: VERSION,
    channel: VERSION.includes("-nightly") ? "nightly" : "stable",
    os: process.platform,
    arch: process.arch,
    client,
  };
}

async function post(path: "/v1/install" | "/v1/usage", body: Report): Promise<void> {
  const response = await fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`);
}

async function firstView(host: Host) {
  for await (const view of host.watch()) return view;

  throw new Error("The host closed before it described itself.");
}

async function writeAtomically(path: string, text: string): Promise<void> {
  const temporary = `${path}.${String(process.pid)}.tmp`;

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, path);
}

function ledgerPath(): string {
  return join(hostMetricsPath(), "usage.json");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
