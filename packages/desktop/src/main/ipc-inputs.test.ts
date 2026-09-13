import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import type { CallRequest } from "../shared/ipc.ts";
import {
  CALL_INPUT_SCHEMAS,
  decodeCallRequest,
  decodeWorkspaceEditorRequest,
  WORKSPACE_EDITOR_INPUT_SCHEMAS,
} from "./ipc-inputs.ts";

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

  test("refuses protocol operations the bridge does not carry", () => {
    // `landing` is in the protocol table but not in SDK_OPERATION_PATHS; the
    // boundary must stop it before the host looks up an input parser for it.
    // SAFETY: the cast feeds the boundary a value its type excludes, which is the point of the test.
    assert.throws(() =>
      decodeCallRequest({ path: "landing", input: undefined } as unknown as CallRequest),
    );
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
      input: { provider: "openai", method: { kind: "api_key", key: "sk-test" }, attempt: "a1" },
    } satisfies CallRequest;
    assert.deepEqual(decodeCallRequest(hide), hide);
    assert.deepEqual(decodeCallRequest(key), key);
    for (const input of [
      { kind: "subagent_model", model: { provider: "echo", id: "echo" } },
      { kind: "subagent_model", model: null },
      { kind: "subagent_model", model: { provider: "echo", id: "echo" }, agent: "general" },
      { kind: "subagent_model" },
    ])
      assert.throws(() => CALL_INPUT_SCHEMAS["host.setPreference"].Parse(input));
    assert.throws(() =>
      CALL_INPUT_SCHEMAS["host.login"].Parse({
        provider: "openai",
        method: { kind: "api_key", key: "" },
        attempt: "a1",
      }),
    );
    // An attempt ID correlates cancel with a running sign-in; it cannot be empty or unbounded.
    for (const attempt of [undefined, "", "x".repeat(65)])
      assert.throws(() =>
        CALL_INPUT_SCHEMAS["host.login"].Parse({
          provider: "openai",
          method: { kind: "browser" },
          attempt,
        }),
      );
    assert.deepEqual(CALL_INPUT_SCHEMAS["host.cancelLogin"].Parse({ attempt: "a1" }), {
      attempt: "a1",
    });
    assert.throws(() => CALL_INPUT_SCHEMAS["host.cancelLogin"].Parse({ attempt: "" }));
    assert.throws(() =>
      CALL_INPUT_SCHEMAS["host.setPreference"].Parse({ kind: "provider", provider: "x" }),
    );
    assert.throws(() =>
      CALL_INPUT_SCHEMAS["host.setPreference"].Parse({
        kind: "subagent_model",
        model: { provider: "", id: "claude" },
      }),
    );
  });
});

describe("parked tool reply IPC inputs", () => {
  test.each(["auto", "installed-provider", "off"])(
    "carries the exact %s reply and call identity",
    (reply) => {
      const request = {
        path: "runs.reply",
        input: {
          sessionId: sessionId("chat"),
          runId: "run",
          callId: "call",
          waitId: "wait",
          reply,
        },
      } satisfies CallRequest;
      assert.deepEqual(decodeCallRequest(request), request);
      assert.deepEqual(CALL_INPUT_SCHEMAS["runs.reply"].Parse(request.input), request.input);
    },
  );

  test("rejects missing replies, stale identities, malformed identities, and extra fields", () => {
    const schema = CALL_INPUT_SCHEMAS["runs.reply"];
    assert.throws(() => schema.Parse({ sessionId: "chat", callId: "call", waitId: "wait" }));
    assert.throws(() => schema.Parse({ sessionId: "chat", callId: "call", reply: "auto" }));
    assert.throws(() =>
      schema.Parse({ sessionId: "chat", callId: 1, waitId: "wait", reply: "auto" }),
    );
    assert.throws(() =>
      schema.Parse({ sessionId: "chat", callId: "call", waitId: 1, reply: "auto" }),
    );
    assert.throws(() =>
      schema.Parse({
        sessionId: "chat",
        callId: "call",
        waitId: "wait",
        runId: 1,
        reply: "auto",
      }),
    );
    assert.throws(() =>
      schema.Parse({
        sessionId: "chat",
        callId: "call",
        waitId: "wait",
        reply: "off",
        consent: true,
      }),
    );
  });
});

describe("workspace file IPC inputs", () => {
  test("decodes file reads through the complete call envelope", () => {
    const read = {
      path: "host.files.read",
      input: { path: "/workspace/package.json" },
    } satisfies CallRequest;

    assert.deepEqual(decodeCallRequest(read), read);
    assert.throws(() => CALL_INPUT_SCHEMAS["host.files.read"].Parse({ path: "" }));
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

describe("jobs IPC inputs", () => {
  test("carries list filters and exact job targets", () => {
    const session = sessionId("chat");
    for (const path of ["jobs.list", "jobs.background", "jobs.cancel"] as const) {
      const request =
        path === "jobs.list"
          ? { path, input: { sessionId: session } }
          : { path, input: { sessionId: session, jobId: "job-1" } };
      assert.deepEqual(decodeCallRequest(request), request);
      assert.deepEqual(CALL_INPUT_SCHEMAS[path].Parse(request.input), request.input);
    }
    assert.deepEqual(CALL_INPUT_SCHEMAS["jobs.list"].Parse({ sessionId: session, head: "main" }), {
      sessionId: session,
      head: "main",
    });
  });

  test("rejects missing job ids and malformed filters", () => {
    for (const path of ["jobs.background", "jobs.cancel"] as const) {
      assert.throws(() => CALL_INPUT_SCHEMAS[path].Parse({ sessionId: "chat" }));
      assert.throws(() => CALL_INPUT_SCHEMAS[path].Parse({ sessionId: "chat", jobId: 7 }));
      assert.throws(() =>
        CALL_INPUT_SCHEMAS[path].Parse({ sessionId: "chat", jobId: "job", restart: true }),
      );
    }
    assert.throws(() => CALL_INPUT_SCHEMAS["jobs.list"].Parse({ sessionId: "chat", head: 7 }));
  });
});

describe("usage IPC inputs", () => {
  test("accepts the existing window but not renderer-selected Claude history paths", () => {
    const input = { sinceDay: null, untilDay: "2026-09-02" };
    assert.deepEqual(CALL_INPUT_SCHEMAS["host.usage"].Parse(input), input);
    assert.throws(() =>
      CALL_INPUT_SCHEMAS["host.usage"].Parse({ ...input, configDir: "/other/history" }),
    );
    assert.throws(() => CALL_INPUT_SCHEMAS["host.usage"].Parse({ ...input, untilDay: 1 }));
  });
});

describe("workspace editor IPC inputs", () => {
  test("accepts optional search filters and bounded drafts", () => {
    const input = {
      requestId: "search-1",
      query: "value",
      caseSensitive: true,
      wholeWord: true,
      regex: false,
      include: ["**/*.ts"],
      exclude: ["**/*.test.ts"],
      maxMatches: 100,
      drafts: [{ path: "/workspace/index.ts", contents: "draft" }],
    };
    const request = { operation: "search", input } as const;
    assert.deepEqual(decodeWorkspaceEditorRequest(request), request);
    assert.deepEqual(WORKSPACE_EDITOR_INPUT_SCHEMAS.search.Parse(input), input);
    assert.deepEqual(WORKSPACE_EDITOR_INPUT_SCHEMAS.cancelSearch.Parse({ requestId: "search-1" }), {
      requestId: "search-1",
    });
  });

  test("refuses oversized inputs, unknown options and renderer-selected commands or cwd", () => {
    const search = WORKSPACE_EDITOR_INPUT_SCHEMAS.search;
    for (const change of [
      { query: "" },
      { maxMatches: 0 },
      { maxMatches: 1001 },
      { regex: "true" },
      { cwd: "/elsewhere" },
      { include: [1] },
      { drafts: [{ path: "/file", contents: "x".repeat(200_001) }] },
    ]) {
      assert.throws(() => search.Parse({ requestId: "search", query: "value", ...change }));
    }
    assert.throws(() => WORKSPACE_EDITOR_INPUT_SCHEMAS.cancelSearch.Parse({ requestId: "" }));
    assert.throws(() =>
      WORKSPACE_EDITOR_INPUT_SCHEMAS.blame.Parse({ path: "/file", revision: "--exec" }),
    );
    const format = { path: "/file", contents: "text", version: "a".repeat(64) };
    assert.deepEqual(WORKSPACE_EDITOR_INPUT_SCHEMAS.format.Parse(format), format);
    assert.throws(() =>
      WORKSPACE_EDITOR_INPUT_SCHEMAS.format.Parse({ ...format, command: "npx prettier" }),
    );
    assert.throws(() =>
      WORKSPACE_EDITOR_INPUT_SCHEMAS.format.Parse({ ...format, version: "stale" }),
    );
  });
});

test("mention discovery and cancellation require bounded request IDs", () => {
  for (const path of ["host.files.list", "host.files.cancelList"] as const) {
    const request = { path, input: { requestId: "mentions-1" } };
    assert.deepEqual(decodeCallRequest(request), request);
    for (const input of [
      undefined,
      {},
      { requestId: "" },
      { requestId: "x".repeat(129) },
      { requestId: "a", extra: true },
    ])
      assert.throws(() => CALL_INPUT_SCHEMAS[path].Parse(input));
  }
});
