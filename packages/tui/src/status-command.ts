import type { Connection, ModelCatalogView } from "@nyte-ai/sdk";
import type { LocalEndpoint } from "@nyte-ai/service";
import { findRunningHost, hostFilePath } from "@nyte-ai/service/host-endpoint";
import { CliError } from "./cli/errors.ts";
import { formatCommand, formatTable } from "./cli/format.ts";
import { parseCommandArgs } from "./cli/options.ts";
import type { Output } from "./cli/output.ts";

/** How long `status` waits for a host that just started to finish checking its credentials. */
const CHECK_WAIT_MS = 5000;

/**
 * `nyte status [--json]`: every provider credential the running host sees, saved or from the
 * environment. A read, so it attaches to the running host and never starts one. A credential the
 * host is still checking after `CHECK_WAIT_MS` shows as `checking`.
 */
export async function statusCommand(input: {
  readonly args: readonly string[];
  readonly output: Output;
  readonly signal: AbortSignal;
  readonly attach: (endpoint: LocalEndpoint) => Promise<Connection>;
}): Promise<void> {
  const json = parseCommandArgs("status", input.args, 0).has("json");
  const out = input.output;
  const running = await findRunningHost(hostFilePath());

  if (running === null)
    throw new CliError("host_not_running", "Can't read credentials without a running Nyte host.", {
      next: [{ label: "Start a host in another terminal", argv: ["nyte", "host"] }],
    });

  const host = await input.attach({ url: running.url, token: running.token });

  const catalog = await checkedCatalog(
    host,
    AbortSignal.any([input.signal, AbortSignal.timeout(CHECK_WAIT_MS)]),
  );

  input.signal.throwIfAborted();

  const credentials = catalog.providers
    .filter((provider) => provider.credential !== "missing")
    .map((provider) => ({
      provider: provider.id,
      credential: provider.credential === "unknown" ? "checking" : provider.credential,
    }));

  if (json) {
    out.json({ credentials });

    return;
  }

  if (credentials.length === 0) {
    out.say("No stored credentials.");
    out.say("");
    out.say("  Sign in to a provider:");
    out.say(formatCommand(["nyte", "login"], out.mode.stderr));

    return;
  }

  const table = formatTable(
    ["Provider", "Credential"],
    credentials.map((row) => [row.provider, row.credential]),
    out.mode.stdout,
  );

  out.result(`${table.join("\n")}\n`);
}

/**
 * `models.list` answers without waiting for the host's credential checks, so a host that just
 * started lists every provider as `unknown`. Each check that settles bumps the catalog generation
 * in `watch()`; re-read on each bump until no credential is `unknown` or `signal` aborts.
 */
async function checkedCatalog(host: Connection, signal: AbortSignal): Promise<ModelCatalogView> {
  let catalog = await host.models.list();

  if (!catalog.providers.some((provider) => provider.credential === "unknown")) return catalog;

  const views = host.watch()[Symbol.asyncIterator]();
  const stopped = Promise.withResolvers<undefined>();
  signal.addEventListener("abort", () => stopped.resolve(undefined), { once: true });

  try {
    while (
      !signal.aborted &&
      catalog.providers.some((provider) => provider.credential === "unknown")
    ) {
      const next = await Promise.race([views.next(), stopped.promise]);

      if (next === undefined || next.done === true) return catalog;

      if (next.value.catalog !== catalog.generation) catalog = await host.models.list();
    }

    return catalog;
  } finally {
    void views.return?.();
  }
}
