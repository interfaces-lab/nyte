import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeModels } from "@nyte-ai/bench";
import { memoryStore } from "@nyte-ai/core/store";
import { localProvider, openHost } from "@nyte-ai/host";
import { afterEach, assert, expect, it } from "vitest";
import ask from "../index.ts";

const REFUSED = "Ask mode doesn't change files or run commands. Describe the change instead.";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

it.each<{
  readonly name: string;
  readonly on: boolean;
  readonly call: { readonly name: string; readonly arguments: Record<string, string> };
  readonly result: string;
  readonly note: string | null;
}>([
  {
    name: "on, a write is refused and the file stays as it was",
    on: true,
    call: { name: "write", arguments: { path: "note.md", content: "Changed." } },
    result: REFUSED,
    note: "Original.",
  },
  {
    name: "on, a shell command is refused",
    on: true,
    call: { name: "bash", arguments: { command: "rm note.md" } },
    result: REFUSED,
    note: "Original.",
  },
  {
    name: "on, a read still runs",
    on: true,
    call: { name: "read", arguments: { path: "note.md" } },
    result: "Original.",
    note: "Original.",
  },
  {
    name: "off, a write runs",
    on: false,
    call: { name: "write", arguments: { path: "note.md", content: "Changed." } },
    result: "",
    note: "Changed.",
  },
])(
  "Ask mode: $name",
  async ({ on, call, result, note }) => {
    const home = await mkdtemp(join(tmpdir(), "nyte-ask-"));
    folders.push(home);
    await writeFile(join(home, "note.md"), "Original.");
    const fake = fakeModels();

    await using host = await openHost({
      store: memoryStore(),
      models: fake.models,
      plugins: [{ id: "local", environment: localProvider({ home }) }, ask],
      workspace: { kind: "local", path: home },
      home,
    });

    expect(await host.settings.apply("permissions", "full")).toMatchObject({ kind: "applied" });
    const workspace = (await host.workspaces.list())[0];
    assert(workspace !== undefined);

    fake.reply(
      { content: [{ type: "toolCall", id: "call", ...call }] },
      { content: [{ type: "text", text: "Done." }] },
    );

    const { receipt } = await host.sessions.start({
      workspace: workspace.id,
      name: "Ask",
      content: "Go.",
      configuration: { settings: { "mode.ask": on } },
    });
    await receipt.settled();

    const answered = (fake.requests.at(-1)?.context.messages ?? []).flatMap((message) =>
      message.role === "toolResult"
        ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
        : [],
    );

    expect(answered.join("\n")).toContain(result);
    expect(await readFile(join(home, "note.md"), "utf8")).toBe(note);
  },
  60_000,
);
