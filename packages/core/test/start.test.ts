import { asId, asSeq } from "@nyte-ai/schema";
import type { PartId } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import type { Plugin } from "../src/index.ts";
import { configuration, main, setup, until } from "../src/harness.ts";
import { TOKEN } from "../src/server.ts";
import { memoryStore } from "../src/store.ts";
import { approve } from "./plugin-support.ts";

const id = asId<"session">("chat-1");

function consent(created: PartId[]): Plugin<"core"> {
  return {
    id: "consent",
    hooks: {
      before_send: async (_submission, context) => {
        const part = await context.api.session.parts.create(approve, {
          state: { tool: "send" },
          placement: { kind: "modal" },
        });

        created.push(part.id);
        const outcome = await context.wait({ kind: "part", part: part.id });

        return outcome.kind === "part" && outcome.answer?.action === "allow"
          ? { action: "continue" }
          : { action: "reject", reason: "The user declined." };
      },
    },
  };
}

describe("sessions.start", () => {
  it("stores the chat, its configuration and its first message in one commit", async () => {
    const { kernel, host } = await setup();
    const { session, receipt } = await host.sessions.start({ name: "triage", content: "Hi." });

    expect(receipt.id).toBe(asId<"receipt">(session.id));
    expect(receipt.message).toBe(asId<"message">(session.id));

    const [created, configured, admitted] = await kernel.store.refs.log(session.id, asSeq(0), 3);

    expect([created?.kind, configured?.kind, admitted]).toMatchObject([
      "session",
      "configured",
      { kind: "input", change: "admitted", content: "Hi.", schedule: { kind: "deciding" } },
    ]);
    expect(new Set([created?.at, configured?.at, admitted?.at]).size).toBe(1);
    expect((await host.sessions.list()).items.map((info) => info.id)).toEqual([session.id]);
    expect((await session.view()).messages).toMatchObject([
      { id: receipt.message, content: "Hi.", status: { kind: "pending" } },
    ]);
  });

  it("returns the same start for the same id and input, and refuses other input under it", async () => {
    const { host } = await setup();
    const first = await host.sessions.start({ id, content: "Once." });
    const again = await host.sessions.start({ id, content: "Once." });

    expect(again.session.id).toBe(first.session.id);
    expect(again.receipt.id).toBe(first.receipt.id);
    expect((await first.session.view()).messages).toHaveLength(1);
    await expect(host.sessions.start({ id, content: "Twice." })).rejects.toMatchObject({
      code: "invalid",
      message: `Session ${id} already exists.`,
    });

    const other = asId<"session">("chat-2");

    const raced = await Promise.allSettled([
      host.sessions.start({ id: other, content: "A." }),
      host.sessions.start({ id: other, content: "B." }),
    ]);

    expect(raced.filter((result) => result.status === "rejected")).toMatchObject([
      { reason: { code: "invalid", message: `Session ${other} already exists.` } },
    ]);
  });

  it("takes the start's configuration as the head's selection and the message's", async () => {
    const { host } = await setup();
    const exact = { ...configuration, thinking: "high" as const };
    const { session } = await host.sessions.start({ configuration: exact, content: "Hi." });
    const view = await session.view();

    expect(view.configuration).toMatchObject({ selected: exact });
  });

  it("leaves nothing behind when before_send refuses or fails, so the id can start again", async () => {
    let calls = 0;

    const { kernel, host } = await setup({
      plugins: [
        {
          id: "gate",
          hooks: {
            before_send: (submission) => {
              calls += 1;

              if (calls === 1) return { action: "reject", reason: "No." };

              if (calls === 2) throw new Error("Broken.");

              return { action: "modify", value: { ...submission, content: "Changed." } };
            },
          },
        },
      ],
    });

    await expect(host.sessions.start({ id, content: "Hi." })).rejects.toMatchObject({
      code: "invalid",
      message: "No.",
    });
    expect(await kernel.store.refs.list(`sessions/${id}/`)).toEqual([]);
    expect((await host.sessions.list()).items).toEqual([]);

    await expect(host.sessions.start({ id, content: "Hi." })).rejects.toMatchObject({
      code: "internal",
    });
    expect((await host.sessions.list()).items).toEqual([]);

    const { session } = await host.sessions.start({ id, content: "Hi." });

    expect(calls).toBe(3);
    expect((await session.view()).messages).toMatchObject([{ content: "Changed." }]);
  });

  it("holds the head while a parked before_send decides, then admits the message once allowed", async () => {
    const created: PartId[] = [];
    const { host } = await setup({ plugins: [consent(created)] });
    const starting = host.sessions.start({ id, content: "Hi." });
    const part = await until(() => created[0]);
    const session = host.session(id);

    expect((await session.view()).messages).toMatchObject([
      { status: { kind: "pending", schedule: { kind: "deciding" } } },
    ]);
    expect(await host.execution.advance({ session: id, head: main })).toEqual({ kind: "idle" });
    await expect(session.send("Edited.", { replace: asId<"message">(id) })).rejects.toMatchObject({
      code: "invalid",
    });

    await session.part(part).act("allow", {});
    const { receipt } = await starting;

    expect((await session.view()).messages).toMatchObject([
      { id: receipt.message, status: { kind: "pending", schedule: { kind: "next-turn" } } },
    ]);
  });

  it("removes the chat when it is stopped while its first message is deciding", async () => {
    const created: PartId[] = [];
    const { kernel, host } = await setup({ plugins: [consent(created)] });
    const starting = host.sessions.start({ id, content: "Hi." });
    await until(() => created[0]);

    expect(await host.session(id).stop()).toEqual({
      stopped: [],
      withdrawn: [asId<"message">(id)],
    });
    await expect(starting).rejects.toMatchObject({ code: "invalid" });
    expect(await kernel.store.refs.list(`sessions/${id}/`)).toEqual([]);
  });

  it("leaves a start deciding when the kernel closes, and a reopened host's repair releases it", async () => {
    const store = await memoryStore().open();
    const created: PartId[] = [];

    const a = await setup({ store, plugins: [consent(created)] });

    const starter = a.kernel.handles.connection({
      principal: TOKEN,
      authority: new Set(["participant"]),
      credential: { kind: "token", token: "t" },
      origin: null,
    });

    const starting = starter.sessions.start({ id, content: "Hi." });
    await until(() => created[0]);
    const closing = a.kernel.executionState.closing;
    a.kernel.executionState.closing = new AbortController();
    closing.abort();
    await expect(starting).rejects.toMatchObject({ code: "unavailable" });

    const b = await setup({
      store,
      execution: { kind: "admit-only" },
      plugins: [consent(created)],
    });

    await b.host.execution.repair({ limit: 10 });
    const part = await until(() => created[1]);
    await b.host.session(id).part(part).act("allow", {});

    await until(async () => {
      const [message] = (await b.host.session(id).view()).messages;

      return message?.kind === "user" &&
        message.status.kind === "pending" &&
        message.status.schedule.kind !== "deciding"
        ? true
        : undefined;
    });
    expect(await store.refs.log(id, asSeq(0), 100)).toContainEqual(
      expect.objectContaining({
        change: "admitted",
        schedule: { kind: "deciding" },
      }),
    );
  });
});
