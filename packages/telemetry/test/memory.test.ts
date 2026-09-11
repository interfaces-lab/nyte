import { expect, test } from "vitest";
import { InMemoryTelemetryContext, NOOP_TELEMETRY_CONTEXT } from "../src/index.ts";
import { conformance } from "./conformance.ts";

for (const entry of conformance) {
  test(entry.name, async () => {
    const telemetry = new InMemoryTelemetryContext();
    await entry.run({
      telemetry,
      started: () => telemetry.spans().map((span) => span.name),
      open: () =>
        telemetry
          .spans()
          .filter((span) => !span.ended)
          .map((span) => span.name),
      spans: () => telemetry.spans().filter((span) => span.ended),
    });
  });
}

test("the no-op context admits synchronously and turns throws into rejections", async () => {
  const failure = Symbol("failure");
  let calls = 0;
  const result = NOOP_TELEMETRY_CONTEXT.startSpan({ name: "work" }, (span) => {
    calls += 1;
    span.setAttributes({ count: 1 });
    span.addEvent("worked");
    span.setStatus({ status: "ok" });
    throw failure;
  });
  expect(calls).toBe(1);
  await expect(result).rejects.toBe(failure);
  expect(calls).toBe(1);
});
