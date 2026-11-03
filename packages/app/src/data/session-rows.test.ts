import assert from "node:assert/strict";
import type { SessionInfo } from "@nyte-ai/sdk";
import { test } from "vitest";
import { sessionRows, subscribeSessionRows } from "./session-rows.ts";
import { installScripted, scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { sessionRow } from "../../test/view-fixtures.ts";

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("the rows keep hearing the host after another connection replaces the first", async () => {
  installScripted(scriptedConnection({ sessions: [sessionRow("chat")] }));
  const leave = subscribeSessionRows(() => undefined);
  await settle();
  assert.equal(sessionRows().roots?.[0]?.name, "chat");

  const sessions = viewStream<readonly SessionInfo[]>([sessionRow("chat")]);
  installScripted(scriptedConnection({ sessions }));
  await settle();
  sessions.push([sessionRow("chat", { name: "renamed" })]);
  await settle();

  assert.equal(sessionRows().roots?.[0]?.name, "renamed");
  leave();
});
