import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { CursorExpired, NyteClosed, UnknownSession, WorkspaceTrustRequired } from "@nyte-ai/core";
import { WorkspaceFileError } from "@nyte-ai/core/files";
import { bridgeError, errorMessage } from "../shared/errors.ts";
import { ipcDiagnostics, ipcResult } from "./errors.ts";
import { callIpc } from "./ipc-call.ts";
import { CALL_INPUT_SCHEMAS } from "./ipc-inputs.ts";
import { Type } from "typebox";
import { ParseError, Value } from "typebox/value";

afterEach(() => ipcDiagnostics.clear());

test("request envelope rejection is redacted before a host is constructed", async () => {
  const request = { path: "host.fonts", input: undefined, credential: "secret-key" } as const;
  const result = await callIpc(() => {
    throw new Error("The invalid envelope must never construct a host");
  }, request);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_input");
  assert.equal(ipcDiagnostics.size, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret-key|credential/);
});

test("operation validation retains bounded issues without input values or property names", async () => {
  const result = await ipcResult(() =>
    CALL_INPUT_SCHEMAS["host.login"].Parse({
      provider: "provider-secret",
      method: { kind: "api_key", key: "", "secret-property": "secret-value" },
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_input");
  assert.ok(result.error.issues.length > 0);
  assert.ok(result.error.issues.length <= 20);
  assert.doesNotMatch(JSON.stringify(result), /provider-secret|secret-property|secret-value/);
  assert.equal(ipcDiagnostics.size, 0);
});

test("expected failures preserve category and cursor but redact local identifiers", async () => {
  for (const [cause, code] of [
    [new CursorExpired(17), "cursor_expired"],
    [new UnknownSession("secret-session"), "unknown_session"],
    [new NyteClosed(), "closed"],
    [new WorkspaceTrustRequired("/secret-project"), "forbidden"],
  ] as const) {
    const result = await ipcResult(() => {
      throw cause;
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    if (result.error.code === "cursor_expired") assert.equal(result.error.floor, 17);
    assert.doesNotMatch(JSON.stringify(result), /secret-session|secret-project/);
  }
  assert.equal(ipcDiagnostics.size, 0);
});

test("a file identity race keeps its retry guidance instead of becoming an opaque diagnostic", async () => {
  const result = await ipcResult(() => {
    throw new WorkspaceFileError("changed");
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_input");
  assert.match(result.error.message, /retry the operation/);
  assert.equal(ipcDiagnostics.size, 0);
});

test("an internal parser failure is not mislabeled as renderer input", async () => {
  const result = await ipcResult(() => Value.Parse(Type.Number(), "private-provider-payload"));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "internal");
  assert.ok(result.error.correlationId);
  const cause = ipcDiagnostics.get(result.error.correlationId);
  assert.ok(cause instanceof ParseError);
  assert.equal(cause.cause.value, "private-provider-payload");
  assert.doesNotMatch(JSON.stringify(result), /private-provider-payload/);
});

test("unexpected TypeError is captured once with its original cause and opaque random ID", async () => {
  const cause = new TypeError("secret-provider-output", { cause: new Error("secret-key") });
  const result = await callIpc(
    () => {
      throw cause;
    },
    { path: "host.fonts", input: undefined },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "internal");
  const id = result.error.correlationId;
  assert.ok(id);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(ipcDiagnostics.size, 1);
  assert.equal(ipcDiagnostics.get(id), cause);
  assert.doesNotMatch(JSON.stringify(result), /secret-provider-output|secret-key|TypeError/);
  const next = await ipcResult(() => {
    throw cause;
  });
  assert.equal(next.ok, false);
  assert.notEqual(next.error.correlationId, id);
});

test("safe bridge failure is plain cloneable data with a wire cause, not a local exception", async () => {
  const result = await ipcResult(() => {
    throw new CursorExpired(23);
  });
  assert.equal(result.ok, false);
  const copied = structuredClone(bridgeError(result.error));
  assert.equal(copied instanceof Error, false);
  assert.deepEqual(copied.cause, result.error);
  assert.equal(errorMessage(copied), result.error.message);
  // This tests data cloning, not Electron's contextBridge implementation.
});
