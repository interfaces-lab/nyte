import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import type { Attributes, Tracer } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace";
import type { RecordedSpan, SpanAttributes, SpanStatus } from "../src/index.ts";
import { createOtelTelemetry } from "../src/otel.ts";
import { conformance } from "./conformance.ts";

function attributesFromOtel(attributes: Attributes): SpanAttributes {
  // SAFETY: the fixture only records values the adapter wrote, and the adapter writes scalars.
  return attributes as SpanAttributes;
}

for (const entry of conformance) {
  test(entry.name, async () => {
    const started: ReadableSpan[] = [];
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({
      spanProcessors: [
        {
          onStart: (span) => {
            started.push(span);
          },
          onEnd() {},
          forceFlush: async () => undefined,
          shutdown: async () => undefined,
        },
        new SimpleSpanProcessor({ exporter }),
      ],
    });
    const idFor = (id: string): number => {
      const index = started.findIndex((span) => span.spanContext().spanId === id);
      assert.ok(index >= 0);
      return index + 1;
    };
    try {
      await entry.run({
        telemetry: createOtelTelemetry(provider.getTracer("conformance")),
        started: () => started.map((span) => span.name),
        open: () => started.filter((span) => !span.ended).map((span) => span.name),
        spans: () =>
          exporter
            .getFinishedSpans()
            .map((span): RecordedSpan => {
              let status: SpanStatus;
              switch (span.status.code) {
                case SpanStatusCode.OK:
                  status = { status: "ok" };
                  break;
                case SpanStatusCode.ERROR:
                  status = { status: "error" };
                  break;
                case SpanStatusCode.UNSET:
                  throw new Error("Finished span has no status");
                default: {
                  const _exhaustive: never = span.status.code;
                  return _exhaustive;
                }
              }
              return {
                id: idFor(span.spanContext().spanId),
                parentId:
                  span.parentSpanContext === undefined
                    ? undefined
                    : idFor(span.parentSpanContext.spanId),
                name: span.name,
                attributes: attributesFromOtel(span.attributes),
                events: span.events.map((event) => ({
                  name: event.name,
                  attributes: attributesFromOtel(event.attributes ?? {}),
                })),
                status,
                ended: span.ended,
              };
            })
            .sort((left, right) => left.id - right.id),
      });
    } finally {
      await provider.shutdown();
    }
  });
}

test("a failing backend start still admits the callback synchronously, once", async () => {
  const tracer: Tracer = {
    startSpan() {
      throw new Error("backend failed");
    },
    startActiveSpan() {
      throw new Error("ambient context must not be used");
    },
  };
  const telemetry = createOtelTelemetry(tracer);
  let calls = 0;
  const result = telemetry.startSpan({ name: "work" }, () => {
    calls += 1;
    return 42;
  });
  expect(calls).toBe(1);
  expect(await result).toBe(42);
  expect(calls).toBe(1);
  const failure = Symbol("business failure");
  await expect(
    telemetry.startSpan({ name: "failed" }, () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
});

test("backend recording and end failures cannot change callback results or rejections", async () => {
  const provider = new TracerProvider();
  const backend = provider.getTracer("failing");
  let endings = 0;
  const tracer: Tracer = {
    startSpan(name, options, parent) {
      const span = backend.startSpan(name, options, parent);
      span.setAttributes = () => {
        throw new Error("attributes failed");
      };
      span.addEvent = () => {
        throw new Error("event failed");
      };
      span.setStatus = () => {
        throw new Error("status failed");
      };
      span.end = () => {
        endings += 1;
        throw new Error("end failed");
      };
      return span;
    },
    startActiveSpan() {
      throw new Error("ambient context must not be used");
    },
  };
  try {
    const telemetry = createOtelTelemetry(tracer);
    let calls = 0;
    const value = { result: "value" };
    expect(
      await telemetry.startSpan({ name: "work" }, (span) => {
        calls += 1;
        span.setAttributes({ count: 1 });
        span.addEvent("worked");
        span.setStatus({ status: "ok" });
        return value;
      }),
    ).toBe(value);
    await expect(
      telemetry.startSpan({ name: "failed" }, (span) => {
        calls += 1;
        span.addEvent("worked");
        throw value;
      }),
    ).rejects.toBe(value);
    expect(calls).toBe(2);
    expect(endings).toBe(2);
  } finally {
    await provider.shutdown();
  }
});
