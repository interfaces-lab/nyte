import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Models } from "@nyte-ai/ai/models";
import type { Host, Plugin } from "@nyte-ai/core";
import { openApprovals } from "@nyte-ai/plugin/approvals/schema";
import { asId } from "@nyte-ai/schema";
import type { ReceiptId, SessionId, SessionInfo, SessionView } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { openHost, sqliteStore } from "@nyte-ai/host";

const SessionIdSchema = Type.String({ minLength: 1 });

const CommandSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("send"),
    text: Type.String(),
    session: Type.Optional(SessionIdSchema),
  }),
  Type.Object({ kind: Type.Literal("settle"), session: SessionIdSchema }),
  Type.Object({
    kind: Type.Literal("approve"),
    session: SessionIdSchema,
    decision: Type.Union([Type.Literal("once"), Type.Literal("session"), Type.Literal("deny")]),
  }),
  Type.Object({ kind: Type.Literal("interrupt"), session: SessionIdSchema }),
  Type.Object({ kind: Type.Literal("view"), session: SessionIdSchema }),
  Type.Object({ kind: Type.Literal("list") }),
  Type.Object({ kind: Type.Literal("listen") }),
  Type.Object({ kind: Type.Literal("kill") }),
  Type.Object({ kind: Type.Literal("restart") }),
]);

export type SimulationCommand = Static<typeof CommandSchema>;

export type SimulationOutcome =
  | { readonly kind: "sent"; readonly session: SessionId; readonly receipt: ReceiptId }
  | { readonly kind: "view"; readonly view: SessionView }
  | { readonly kind: "approved"; readonly tool: string }
  | { readonly kind: "stopped"; readonly runs: number }
  | { readonly kind: "list"; readonly sessions: readonly SessionInfo[] }
  | { readonly kind: "listening"; readonly url: string; readonly token: string }
  | { readonly kind: "killed" }
  | { readonly kind: "restarted" };

export interface Simulation extends AsyncDisposable {
  readonly host: Host;
  readonly home: string;
  readonly workspace: string;
  drive(command: SimulationCommand): Promise<SimulationOutcome>;
}

export function readCommand(
  line: string,
):
  | { readonly kind: "command"; readonly command: SimulationCommand }
  | { readonly kind: "invalid"; readonly reason: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return { kind: "invalid", reason: error instanceof Error ? error.message : String(error) };
  }

  if (Value.Check(CommandSchema, parsed)) return { kind: "command", command: parsed };
  const [error] = Value.Errors(CommandSchema, parsed);

  return { kind: "invalid", reason: `${error?.instancePath ?? ""} ${error?.message ?? ""}`.trim() };
}

export async function simulate(input: {
  readonly models: Models;
  readonly plugins?: readonly Plugin<"core">[];
  readonly home?: string;
  readonly workspace?: string;
}): Promise<Simulation> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "nyte-simulation-")));
  const home = input.home ?? join(folder, "home");
  const workspace = input.workspace ?? join(folder, "workspace");
  const path = join(folder, "nyte.db");
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const token = crypto.randomUUID();

  const boot = async () => {
    const store = sqliteStore({ path });

    const host = await openHost({
      store,
      models: input.models,
      plugins: input.plugins,
      workspace: { kind: "local", path: workspace },
      home,
    });

    return { store, host };
  };

  let running: Awaited<ReturnType<typeof boot>> | null = await boot();
  let port: number | null = null;
  const receipts = new Map<SessionId, { settled(): Promise<unknown> }>();

  const current = (): Host => {
    if (running === null) throw new Error("The simulated host is down; restart it first.");

    return running.host;
  };

  const listen = async (): Promise<string> => {
    const listener = await current().listen({
      transport: { kind: "http", hostname: "127.0.0.1", port: port ?? 0 },
      auth: { kind: "token", token },
    });

    if (listener.address === null) throw new Error("The simulated host has no address.");
    port = Number(new URL(listener.address).port);

    return listener.address;
  };

  const stop = async (): Promise<void> => {
    const stopping = running;
    running = null;
    receipts.clear();

    if (stopping === null) return;
    await stopping.host.close();
    await stopping.store.close();
  };

  const drive = async (command: SimulationCommand): Promise<SimulationOutcome> => {
    switch (command.kind) {
      case "send": {
        if (command.session === undefined) {
          const { session, receipt } = await current().sessions.start({ content: command.text });
          receipts.set(session.id, receipt);

          return { kind: "sent", session: session.id, receipt: receipt.id };
        }

        const session = asId<"session">(command.session);
        const receipt = await current().session(session).send(command.text);
        receipts.set(session, receipt);

        return { kind: "sent", session, receipt: receipt.id };
      }

      case "settle": {
        const session = asId<"session">(command.session);
        await receipts.get(session)?.settled();

        return { kind: "view", view: await current().session(session).view() };
      }

      case "approve": {
        const session = current().session(asId<"session">(command.session));

        for await (const view of session.watch()) {
          const [open] = openApprovals(view);

          if (open === undefined) continue;
          await session.part(open.part).act(command.decision, {});

          return { kind: "approved", tool: open.tool };
        }

        throw new Error("The session's watch ended before an approval opened.");
      }

      case "interrupt": {
        const { stopped } = await current().session(asId<"session">(command.session)).stop();

        return { kind: "stopped", runs: stopped.length };
      }

      case "view":
        return {
          kind: "view",
          view: await current().session(asId<"session">(command.session)).view(),
        };
      case "list":
        return {
          kind: "list",
          sessions: (await current().sessions.list({ parents: { kind: "roots" } })).items,
        };
      case "listen":
        return { kind: "listening", url: await listen(), token };
      case "kill":
        await stop();

        return { kind: "killed" };
      case "restart": {
        await stop();
        running = await boot();

        if (port !== null) await listen();

        return { kind: "restarted" };
      }

      default: {
        const exhaustive: never = command;

        return exhaustive;
      }
    }
  };

  const dispose = async (): Promise<void> => {
    await stop();
    await rm(folder, { recursive: true, force: true, maxRetries: 10 });
  };

  return {
    get host() {
      return current();
    },
    home,
    workspace,
    drive,
    [Symbol.asyncDispose]: dispose,
  };
}
