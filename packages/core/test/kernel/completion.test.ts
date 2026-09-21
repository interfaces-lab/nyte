import { expect, test } from "vitest";
import type { Message } from "@nyte-ai/schema";
import { contextMessages } from "@nyte-ai/client";
import { branch } from "../../src/kernel/graph.ts";
import { headRef } from "../../src/kernel/names.ts";
import { pending, submit } from "../../src/kernel/queue.ts";
import { pendingItems } from "../../src/kernel/sdk/snapshot.ts";
import { drive } from "../../src/kernel/step.ts";
import type { Turn } from "../../src/kernel/turn.ts";
import { transcriptFromCommits } from "@nyte-ai/client";
import { assistant, message, openSession, user } from "./helpers.ts";

test("completion joins the next response without swallowing or impersonating queued user input", async () => {
  const session = await openSession();
  const requests: Message[][] = [];
  const turn: Turn = {
    respond: async (input) => {
      requests.push(contextMessages(input.commits.map((item) => item.commit)));
      return { kind: "complete", message: assistant("Result received") };
    },
    tools: async () => {
      throw new Error("No tools expected");
    },
  };
  for (const content of ["first question", "second question"]) {
    await submit(session, {
      preparation: { kind: "none" },
      head: "main",
      kind: "user",
      delivery: "next",
      body: message(user(content)),
    });
  }
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    kind: "report",
    delivery: "steer",
    body: {
      kind: "completion",
      job: {
        kind: "command",
        id: "job",
        command: "Check build",
        end: { kind: "completed" },
        output: "Build passed",
      },
    },
  });
  expect(pendingItems(await pending(session, "main")).map((item) => item.content)).toEqual([
    "first question",
    "second question",
  ]);
  const options = {
    head: "main",
    drain: "one",
  } satisfies Parameters<typeof drive>[2];
  await drive(session, turn, options);
  expect(requests).toEqual([
    [
      expect.objectContaining({ role: "user", content: "first question" }),
      expect.objectContaining({ role: "user", content: expect.stringContaining("Build passed") }),
    ],
  ]);
  expect(pendingItems(await pending(session, "main")).map((item) => item.content)).toEqual([
    "second question",
  ]);
  await drive(session, turn, options);
  expect(requests[1]?.at(-1)).toMatchObject({ role: "user", content: "second question" });
  const commits = await branch(session.objects, await session.refs.read(headRef("main")));
  const transcript = transcriptFromCommits(commits);
  expect(
    transcript.flatMap((turn) =>
      turn.kind === "turn"
        ? turn.parts.filter((part) => part.kind === "user").map((part) => part.content)
        : [],
    ),
  ).toEqual(["first question", "second question"]);
});

test("stopping the response to a landed completion keeps it out of the request turn and in later context", async () => {
  const session = await openSession();
  const requests: Message[][] = [];
  let outcome: "aborted" | "complete" = "aborted";
  const turn: Turn = {
    respond: async (input) => {
      requests.push(contextMessages(input.commits.map((item) => item.commit)));
      return outcome === "aborted"
        ? {
            kind: "aborted",
            message: assistant("", { stop: "aborted" }),
            failure: { class: "aborted", message: "Aborted" },
          }
        : { kind: "complete", message: assistant("Answered") };
    },
    tools: async () => {
      throw new Error("No tools expected");
    },
  };
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    kind: "user",
    delivery: "next",
    body: message(user("question")),
  });
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    kind: "report",
    delivery: "steer",
    body: {
      kind: "completion",
      job: {
        kind: "command",
        id: "job",
        command: "Check build",
        end: { kind: "completed" },
        output: "Build passed",
      },
    },
  });
  const options = {
    head: "main",
    drain: "one",
  } satisfies Parameters<typeof drive>[2];
  await drive(session, turn, options);
  const stopped = transcriptFromCommits(
    await branch(session.objects, await session.refs.read(headRef("main"))),
  ).filter((item) => item.kind === "turn");
  // The completion's continuation turn owns the stopped response; the user
  // request stays a lone turn a client may hand back to the composer.
  expect(stopped).toHaveLength(2);
  expect(stopped[0]?.parts.map((part) => part.kind)).toEqual(["user"]);
  expect(stopped[1]?.parts.some((part) => part.kind === "user")).toBe(false);
  expect(stopped[1]?.failure?.class).toBe("aborted");
  outcome = "complete";
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    kind: "user",
    delivery: "next",
    body: message(user("again")),
  });
  await drive(session, turn, options);
  expect(requests.at(-1)).toEqual([
    expect.objectContaining({ role: "user", content: "question" }),
    expect.objectContaining({ role: "user", content: expect.stringContaining("Build passed") }),
    expect.objectContaining({ role: "user", content: "again" }),
  ]);
});
