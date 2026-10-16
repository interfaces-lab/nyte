import { asId, standard } from "@nyte-ai/schema";
import type { PartId, Schema, SessionId, ToolOutcome } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert } from "vitest";
import { ALL_AUTHORITY, LOCAL, definePart } from "../src/index.ts";
import { callRef, decodeCallRecord, decodePartRecord } from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type {
  Command,
  ConnectionContext,
  EnvironmentProvider,
  Plugin,
  SettingDefinition,
  ToolDefinition,
} from "../src/index.ts";
import type { CallRecord } from "../src/store.ts";
import { env, setup } from "../src/harness.ts";

export const caller: ConnectionContext = {
  principal: LOCAL,
  authority: ALL_AUTHORITY,
  credential: { kind: "token", token: "x" },
  origin: null,
};

export const ok = {
  kind: "ok",
  content: [{ kind: "text", text: "hi" }],
  output: null,
  parts: [],
} satisfies ToolOutcome;

export const echo = {
  name: "echo",
  description: "Echo the text.\nIt says it back.",
  parameters: standard(Type.Object({ text: Type.String() })),
  class: () => ({ kind: "custom", label: "Echoing" }),
  replay: "safe",
  execute: async (args) => ({ content: [{ kind: "text", text: args.text }] }),
} satisfies ToolDefinition<{ text: string }>;

export const opaque: Schema<unknown> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => ({ value }),
    jsonSchema: {
      input: () => {
        throw new Error("No JSON Schema.");
      },
      output: () => {
        throw new Error("No JSON Schema.");
      },
    },
  },
};

export const volume: SettingDefinition<number> = {
  id: "volume",
  label: "Volume",
  schema: standard(Type.Integer({ minimum: 0 })),
  default: 3,
  scope: "host",
};

export const theme: SettingDefinition<string> = {
  id: "theme",
  label: "Theme",
  schema: standard(Type.Union([Type.Literal("light"), Type.Literal("dark")])),
  choices: [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark", badge: "new" },
  ],
  default: "light",
  scope: "host",
};

export const approve = definePart({
  kind: "gate/approve",
  state: standard(Type.Object({ tool: Type.String() })),
  actions: {
    allow: { input: standard(Type.Object({})) },
    deny: { input: standard(Type.Object({})) },
  },
  fallback: (state, { id }) => `Allow ${state.tool}? (${id})`,
});

export async function approvals(kernel: Kernel, session: SessionId): Promise<readonly PartId[]> {
  const stored = await Promise.all(
    (await kernel.store.refs.list(`sessions/${session}/parts/`)).map(async (ref) =>
      decodePartRecord(ref.target === null ? null : await kernel.store.objects.get(ref.target)),
    ),
  );

  return stored.flatMap((record) => (record?.partKind === approve.kind ? [record.id] : []));
}

export function says(name: string, answer: string): Command {
  return { name, title: name, description: `Says ${answer}.`, run: () => answer };
}

export function provider(kind: string): EnvironmentProvider {
  return {
    kind,
    inspect: async () => ({
      identity: asId("identity"),
      availability: { kind: "available" },
      projectSources: [],
    }),
    attach: async () => env,
  };
}

export async function loaded(
  plugins: readonly Plugin<"core">[],
  options?: Parameters<typeof setup>[0],
) {
  const built = await setup(options);
  built.kernel.plugins.host = plugins;
  const session = await built.host.sessions.create();

  return { ...built, session, runtime: built.kernel.plugins.runtime(session.id) };
}

export async function readCall(
  kernel: Kernel,
  session: SessionId,
  id: string,
): Promise<CallRecord> {
  const ref = await kernel.store.refs.get(callRef(session, asId<"call">(id)));
  const record = decodeCallRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
  assert(record !== null);

  return record;
}
