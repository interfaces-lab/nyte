import assert from "node:assert/strict";
import { createServer } from "node:http";
import { text } from "node:stream/consumers";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterEach, test, vi } from "vitest";
import { NOOP_TELEMETRY_CONTEXT } from "@nyte-ai/telemetry";
import { createOtelExport } from "../src/otel.ts";

afterEach(() => vi.unstubAllEnvs());

test("export is off without an endpoint", async () => {
  vi.stubEnv("NYTE_OTEL_ENDPOINT", undefined);
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:1");
  const otel = createOtelExport({ serviceName: "off" });
  assert.equal(otel.telemetry, NOOP_TELEMETRY_CONTEXT);
  assert.equal(await otel.telemetry.startSpan({ name: "noop" }, () => 42), 42);
  await otel.shutdown();
});

const payload = Type.Object({
  resourceSpans: Type.Array(
    Type.Object({
      resource: Type.Object({
        attributes: Type.Array(
          Type.Object({ key: Type.String(), value: Type.Object({ stringValue: Type.String() }) }),
        ),
      }),
      scopeSpans: Type.Array(
        Type.Object({
          spans: Type.Array(
            Type.Object({
              name: Type.String(),
              traceId: Type.String(),
              spanId: Type.String(),
              parentSpanId: Type.Optional(Type.String()),
            }),
          ),
        }),
      ),
    }),
  ),
});

test.each(["explicit", "origin", "path"])(
  "%s endpoint exports nested spans and shutdown flushes",
  async (mode) => {
    const requests: { path: string | undefined; body: string }[] = [];
    const server = createServer((request, response) => {
      void text(request)
        .then((body) => {
          requests.push({ path: request.url, body });
          response.writeHead(200, { "content-type": "application/json" });
          response.end("{}");
        })
        .catch(() => {
          response.writeHead(500);
          response.end();
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address !== null && !Value.Check(Type.String(), address));
      const origin = `http://127.0.0.1:${address.port}`;
      vi.stubEnv("NYTE_OTEL_ENDPOINT", mode === "origin" ? origin : `${origin}/custom/traces`);
      const otel = createOtelExport({
        serviceName: "nyte-host-test",
        endpoint: mode === "explicit" ? `${origin}/explicit/traces` : undefined,
      });
      try {
        const result = await otel.telemetry.startSpan({ name: "parent" }, (parent) =>
          parent.startSpan({ name: "child" }, () => "answer"),
        );
        assert.equal(result, "answer");
      } finally {
        await otel.shutdown();
      }
      assert.equal(requests.length, 1);
      assert.equal(
        requests[0]?.path,
        mode === "explicit"
          ? "/explicit/traces"
          : mode === "origin"
            ? "/v1/traces"
            : "/custom/traces",
      );
      const parsed: unknown = JSON.parse(requests[0]?.body ?? "{}");
      assert.ok(Value.Check(payload, parsed));
      const resource = parsed.resourceSpans[0];
      assert.ok(resource);
      assert.ok(
        resource.resource.attributes.some(
          (attribute) =>
            attribute.key === "service.name" && attribute.value.stringValue === "nyte-host-test",
        ),
      );
      const spans = resource.scopeSpans.flatMap((scope) => scope.spans);
      const parent = spans.find((span) => span.name === "parent");
      const child = spans.find((span) => span.name === "child");
      assert.ok(parent && child);
      assert.equal(child.traceId, parent.traceId);
      assert.equal(child.parentSpanId, parent.spanId);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
