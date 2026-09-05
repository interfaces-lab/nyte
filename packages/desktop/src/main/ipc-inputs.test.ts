import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import type { CallRequest } from "../shared/ipc.ts";
import { CALL_INPUT_SCHEMAS, decodeCallRequest } from "./ipc-inputs.ts";

describe("plugin command IPC inputs", () => {
  test("decodes the sessionless plugin catalog request", () => {
    const catalog = { path: "plugins.catalog", input: undefined } satisfies CallRequest;

    assert.deepEqual(decodeCallRequest(catalog), catalog);
  });

  test("decodes command list and run requests", () => {
    const id = sessionId("session-1");
    const list = {
      path: "plugins.commands.list",
      input: { sessionId: id },
    } satisfies CallRequest;
    const run = {
      path: "plugins.commands.run",
      input: { sessionId: id, name: "rename", argument: "A useful name" },
    } satisfies CallRequest;

    assert.deepEqual(decodeCallRequest(list), list);
    assert.deepEqual(decodeCallRequest(run), run);
  });

  test("rejects malformed command run requests", () => {
    const schema = CALL_INPUT_SCHEMAS["plugins.commands.run"];

    assert.throws(() => schema.Parse({ sessionId: "session-1", name: "rename", argument: 1 }));
    assert.throws(() => schema.Parse({ sessionId: "session-1", name: "rename", unexpected: true }));
  });

  test("decodes catalog preference and login requests and rejects empty keys", () => {
    const hide = {
      path: "host.setPreference",
      input: { kind: "models", provider: "openai", ids: ["gpt-4"], hidden: true },
    } satisfies CallRequest;
    const key = {
      path: "host.login",
      input: { provider: "openai", method: { kind: "api_key", key: "sk-test" } },
    } satisfies CallRequest;
    assert.deepEqual(decodeCallRequest(hide), hide);
    assert.deepEqual(decodeCallRequest(key), key);
    assert.throws(() =>
      CALL_INPUT_SCHEMAS["host.login"].Parse({
        provider: "openai",
        method: { kind: "api_key", key: "" },
      }),
    );
    assert.throws(() =>
      CALL_INPUT_SCHEMAS["host.setPreference"].Parse({ kind: "provider", provider: "x" }),
    );
  });
});

describe("browser actions", () => {
  test("rejects arbitrary actions and malformed menu anchors at the IPC boundary", () => {
    assert.throws(() =>
      CALL_INPUT_SCHEMAS["host.browser.perform"].Parse({
        surface: "tab",
        action: "execute-javascript",
      }),
    );
    assert.throws(() =>
      CALL_INPUT_SCHEMAS["host.browser.menu"].Parse({
        surface: "tab",
        bookmarksVisible: true,
        x: "1",
        y: 2,
      }),
    );
    assert.throws(() =>
      CALL_INPUT_SCHEMAS["host.browser.perform"].Parse({ surface: "", action: "clear-cookies" }),
    );
  });
});
