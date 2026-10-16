import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { SdkError } from "@nyte-ai/sdk";
import { bridgeError, errorMessage } from "@nyte-ai/app/errors.ts";
import { ipcDiagnostics, ipcResult } from "./errors.ts";
import { throwForRenderer } from "./host.ts";
import { callIpc } from "./ipc-call.ts";
import { CALL_INPUT_SCHEMAS } from "./ipc-inputs.ts";
import { Type } from "typebox";
import { ParseError, Value } from "typebox/value";

afterEach(() => ipcDiagnostics.clear());

test("request envelope rejection is redacted before a host is constructed", async () => {
  const request = { path: "host.fonts", input: undefined, credential: "secret-key" } as const;

  const result = await callIpc(
    () => {
      throw new Error("The invalid envelope must never construct a host");
    },
    1,
    request,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid");
  assert.equal(ipcDiagnostics.size, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret-key|credential/);
});

test("operation validation names no input values or property names", async () => {
  const result = await ipcResult(() =>
    CALL_INPUT_SCHEMAS["host.server.connect"].Parse({
      url: "https://server-secret.example",
      token: "",
      "secret-property": "secret-value",
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid");
  assert.doesNotMatch(JSON.stringify(result), /server-secret|secret-property|secret-value/);
  assert.equal(ipcDiagnostics.size, 0);
});

test("an sdk failure keeps its code and message through the host process and leaves no diagnostic", async () => {
  for (const code of ["unknown", "stale", "unavailable", "denied"] as const) {
    const result = await ipcResult(() =>
      throwForRenderer(new SdkError(code, "The host answered.")),
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.equal(result.error.message, "The host answered.");
  }

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
    1,
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
  const result = await ipcResult(() =>
    throwForRenderer(new SdkError("stale", "The host moved on.")),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "stale");
  const copied = structuredClone(bridgeError(result.error));
  assert.equal(copied instanceof Error, false);
  assert.deepEqual(copied.cause, result.error);
  assert.equal(errorMessage(copied), result.error.message);
});
