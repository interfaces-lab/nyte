import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { SdkError } from "@nyte-ai/sdk";
import { ExpectedHostError, ipcDiagnostics, ipcResult } from "../shared/errors.ts";
import { throwForRenderer } from "./desktop-host.ts";
import { callIpc } from "../shared/ipc-call.ts";
import { Type } from "typebox";
import { ParseError, Value } from "typebox/value";

afterEach(() => ipcDiagnostics.clear());

test("a raw call is rejected as invalid before its route runs, naming nothing it carried", async () => {
  for (const row of [
    {
      request: { path: "host.fonts", input: undefined, credential: "secret-key" },
      code: "invalid",
    },
    {
      request: {
        path: "host.server.connect",
        input: {
          baseUrl: "https://server-secret.example",
          token: "",
          "secret-property": "secret-value",
        },
      },
      code: "invalid",
    },
    {
      request: { path: "host.usage", input: { sinceDay: null, untilDay: "bad" } },
      code: "invalid",
    },
    {
      request: { path: "host.usage", input: { sinceDay: null, untilDay: "2026-02-30" } },
      code: "invalid",
    },
    {
      request: { path: "host.usage", input: { sinceDay: "2026-09-03", untilDay: "2026-09-02" } },
      code: "invalid",
    },
    {
      request: {
        path: "host.usage",
        input: { sinceDay: null, untilDay: "2026-09-02", extra: true },
      },
      code: "invalid",
    },
    {
      request: { path: "host.usage", input: { sinceDay: null, untilDay: "2026-09-02" } },
      code: "stale",
    },
  ] as const) {
    const result = await callIpc(
      (_window, path, input) => {
        assert.deepEqual({ path, input }, row.request);

        throw new ExpectedHostError({ code: "stale", message: "The route ran." });
      },
      1,
      row.request,
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, row.code, JSON.stringify(row.request));
    assert.equal(ipcDiagnostics.size, 0);
    assert.doesNotMatch(JSON.stringify(result), /secret|credential/);
  }
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
