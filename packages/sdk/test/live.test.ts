import { asId } from "@nyte-ai/schema";
import type { Json, PartId, RunId, SessionId, SessionView } from "@nyte-ai/schema";
import { envelope, partRef, publishPatch, publishSet } from "@nyte-ai/core";
import type { Connection, Kernel, PartRecord } from "@nyte-ai/core";
import { afterEach, describe, expect, it } from "vitest";
import { connect } from "../src/connect.ts";
import { createSendJournal } from "../src/journal.ts";
import { BASE, TOKEN_SECRET, operationOf, served, until } from "./served.ts";
import type { Served } from "./served.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const main = asId<"head">("main");

async function open(): Promise<{ readonly host: Served; readonly connection: Connection }> {
  const host = await served();
  cleanups.push(() => host.close());

  const connection = await connect({
    url: BASE,
    credentials: { kind: "token", token: TOKEN_SECRET },
    fetch: host.fetch,
    journal: createSendJournal(),
  });

  cleanups.push(() => connection.close());

  return { host, connection };
}

async function livePart(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  part: PartId,
  partKind = "text",
  state: Json = { markdown: "", signature: null },
) {
  const record: PartRecord = {
    id: part,
    partKind,
    placement: { kind: "transcript", role: partKind === "text" ? "answer" : "step" },
    state,
    version: 1,
    owner: null,
    run,
    status: { kind: "live", run },
  };

  const updates = [
    {
      name: partRef(session, part),
      target: await kernel.store.objects.put(envelope("part", record, Date.now())),
      events: [
        {
          head: asId<"head">("main"),
          kind: "part",
          part,
          change: "created",
          partKind,
          placement: record.placement,
          state: record.state,
          version: 1,
          run,
          owner: null,
        } as const,
      ],
    },
  ];

  await publishSet(kernel, updates, await kernel.store.refs.set(updates));

  return record;
}

async function updatePart(kernel: Kernel, session: SessionId, record: PartRecord, state: Json) {
  const updates = [
    {
      name: partRef(session, record.id),
      target: await kernel.store.objects.put(
        envelope("part", { ...record, state, version: 2 }, Date.now()),
      ),
      events: [
        {
          head: main,
          kind: "part",
          part: record.id,
          change: "updated",
          state,
          version: 2,
        } as const,
      ],
    },
  ];

  await publishSet(kernel, updates, await kernel.store.refs.set(updates));
}

function progress(view: SessionView, part: PartId): string | null {
  const found = view.messages.find((message) => message.kind === "part" && message.part === part);

  return found?.kind === "part" &&
    typeof found.state === "object" &&
    found.state !== null &&
    "progress" in found.state &&
    typeof found.state.progress === "object" &&
    found.state.progress !== null &&
    "text" in found.state.progress &&
    typeof found.state.progress.text === "string"
    ? found.state.progress.text
    : null;
}

function markdown(view: SessionView, part: PartId): string | null {
  const found = view.messages.find((message) => message.kind === "part" && message.part === part);

  return found?.kind === "part" &&
    typeof found.state === "object" &&
    found.state !== null &&
    "markdown" in found.state &&
    typeof found.state.markdown === "string"
    ? found.state.markdown
    : null;
}

describe("live parts across a reconnect", () => {
  it("resumes a head.watch with the text a part streamed while the link was down, from any publisher (ADV F P4, §54b)", async () => {
    const host = await served();
    cleanups.push(() => host.close());

    const connection = await connect({
      url: BASE,
      credentials: { kind: "token", token: TOKEN_SECRET },
      fetch: host.fetch,
      journal: createSendJournal(),
    });

    cleanups.push(() => connection.close());
    const session = await connection.sessions.create();
    const kernel = host.host.kernel;
    const part = asId<"part">("p4-stream");
    const run = asId<"run">("p4-run");
    const patch = (append: string) =>
      publishPatch(kernel, session.id, run, { kind: "patch", part, append });

    await livePart(kernel, session.id, run, part);
    let opens = 0;

    host.intercept(async (request, next) => {
      if (operationOf(request) === "head.watch" && ++opens === 2) patch("B");

      return next(request);
    });

    let step = 0;

    await until(session.watch(), (view) => {
      const shown = markdown(view, part);

      if (shown === "" && step === 0) {
        step = 1;
        patch("A");
      } else if (shown === "A" && step === 1) {
        step = 2;
        host.listener.disconnectClients();
      } else if (shown === "AB" && step === 2) {
        step = 3;
        patch("C");
      }

      return shown === "ABC";
    });

    expect(opens).toBe(2);
    expect(markdown(await host.view(session.id), part)).toBe("ABC");
  });

  it("resumes with a part's durably revised text, never the text streamed before it (AUDIT-D1-2 update, §54b)", async () => {
    const { host, connection } = await open();
    const session = await connection.sessions.create();
    const kernel = host.host.kernel;
    const part = asId<"part">("revised");
    const run = asId<"run">("revised-run");
    const patch = (append: string) =>
      publishPatch(kernel, session.id, run, { kind: "patch", part, append });

    const record = await livePart(kernel, session.id, run, part);
    let opens = 0;

    host.intercept(async (request, next) => {
      if (operationOf(request) === "head.watch" && ++opens === 2) {
        await updatePart(kernel, session.id, record, { markdown: "X", signature: null });
        patch("B");
      }

      return next(request);
    });

    let step = 0;

    await until(session.watch(), (view) => {
      const shown = markdown(view, part);

      if (shown === "" && step === 0) {
        step = 1;
        patch("A");
      } else if (shown === "A" && step === 1) {
        step = 2;
        host.listener.disconnectClients();
      } else if (shown === "XB" && step === 2) {
        step = 3;
        patch("C");
      }

      return shown === "XBC";
    });

    expect(markdown(await host.view(session.id), part)).toBe("XBC");
  });

  it("resumes with a tool part's latest progress (AUDIT-D1-2 progress, §54b)", async () => {
    const { host, connection } = await open();
    const session = await connection.sessions.create();
    const kernel = host.host.kernel;
    const part = asId<"part">("running");
    const run = asId<"run">("running-run");
    const report = (text: string) =>
      publishPatch(kernel, session.id, run, { kind: "patch", part, progress: { text } });

    await livePart(kernel, session.id, run, part, "tool", {
      call: "running",
      name: "probe",
      args: {},
      class: { kind: "custom", label: "probe" },
      phase: "running",
      progress: null,
    });

    let opens = 0;

    host.intercept(async (request, next) => {
      if (operationOf(request) === "head.watch" && ++opens === 2) report("B");

      return next(request);
    });

    let step = 0;

    await until(session.watch(), (view) => {
      const shown = progress(view, part);

      if (shown === null && step === 0) {
        step = 1;
        report("A");
      } else if (shown === "A" && step === 1) {
        step = 2;
        host.listener.disconnectClients();
      } else if (shown === "B" && step === 2) {
        step = 3;
        report("C");
      }

      return shown === "C";
    });

    expect(opens).toBe(2);
  });
});
