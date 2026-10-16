import { asId } from "@nyte-ai/schema";
import type { FileDocument } from "@nyte-ai/schema";
import { assert, expect, it } from "vitest";
import { composeHost } from "../src/server.ts";
import { memoryStore } from "../src/store.ts";
import type { Plugin } from "../src/index.ts";
import { fakeModels } from "./fake-models.ts";
import type { Request } from "./fake-models.ts";
import { env } from "../src/harness.ts";

function notes(files: Map<string, string>): Plugin<"core"> {
  const read = async (path: string): Promise<FileDocument> => {
    const contents = files.get(path);

    if (contents === undefined) throw new Error(`No file ${path}.`);

    return { kind: "text", path, contents, version: asId(`v-${contents.length}`) };
  };

  return {
    id: "notes",
    environment: {
      kind: "notes",
      inspect: async () => ({
        identity: asId("notes"),
        availability: { kind: "available" },
        projectSources: [],
      }),
      attach: async () => ({ ...env, identity: asId("notes"), files: { ...env.files, read } }),
    },
  };
}

function userText(request: Request | undefined): string {
  const user = request?.context.messages.find((message) => message.role === "user");

  assert(user?.role === "user" && Array.isArray(user.content));

  return user.content.map((part) => (part.type === "text" ? part.text : "")).join("|");
}

it("shows the model a mentioned file as it was at send, and a skill as a pointer to its file", async () => {
  const files = new Map([["/work/plan.md", "Ship on Friday."]]);
  const fake = fakeModels();
  fake.reply(
    { content: [{ type: "text", text: "Noted." }] },
    { content: [{ type: "text", text: "Still noted." }] },
  );

  await using host = await composeHost({
    store: memoryStore(),
    models: fake.models,
    plugins: [notes(files)],
    workspace: { kind: "notes", locator: null },
    home: null,
    description: { name: "test", platform: "darwin", version: "0.1.0" },
  });

  const { session, receipt } = await host.sessions.start({
    content: [
      { kind: "skill", name: "review", location: "/skills/review/SKILL.md" },
      { kind: "text", text: "Read " },
      { kind: "reference", path: "/work/plan.md" },
      { kind: "reference", path: "/work/missing.md" },
    ],
  });

  await receipt.settled();
  files.set("/work/plan.md", "Ship on Monday.");
  await (await session.send("And now?")).settled();

  const expected = [
    '<skill name="review" location="/skills/review/SKILL.md">\nRead the skill\'s file at its location and follow it.\n</skill>',
    "Read ",
    '<file path="/work/plan.md">\nShip on Friday.\n</file>',
    "[Reference: /work/missing.md]",
  ].join("|");

  expect(userText(fake.requests[0])).toBe(expected);
  expect(userText(fake.requests[1])).toBe(expected);
});
