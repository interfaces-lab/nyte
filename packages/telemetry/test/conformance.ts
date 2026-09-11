import { expect } from "vitest";
import type { RecordedSpan, TelemetryContext } from "../src/index.ts";

export interface Fixture {
  readonly telemetry: TelemetryContext;
  started(): readonly string[];
  open(): readonly string[];
  spans(): readonly RecordedSpan[];
}

export const conformance: readonly {
  readonly name: string;
  readonly run: (fixture: Fixture) => Promise<void>;
}[] = [
  {
    name: "creates the span and admits the callback synchronously, once",
    async run(fixture) {
      let calls = 0;
      const result = fixture.telemetry.startSpan({ name: "work" }, () => {
        calls += 1;
        expect(fixture.started()).toEqual(["work"]);
        expect(fixture.open()).toEqual(["work"]);
      });
      expect(calls).toBe(1);
      await result;
      expect(calls).toBe(1);
      expect(fixture.open()).toEqual([]);
    },
  },
  {
    name: "preserves value identity",
    async run(fixture) {
      const value = { result: "value" };
      expect(await fixture.telemetry.startSpan({ name: "sync" }, () => value)).toBe(value);
      expect(
        await fixture.telemetry.startSpan({ name: "async" }, () => Promise.resolve(value)),
      ).toBe(value);
    },
  },
  {
    name: "preserves rejection identity",
    async run(fixture) {
      const failure = { reason: "rejected" };
      await expect(
        fixture.telemetry.startSpan({ name: "work" }, () => Promise.reject(failure)),
      ).rejects.toBe(failure);
    },
  },
  {
    name: "turns a synchronous throw into a rejection with the same value",
    async run(fixture) {
      const failure = Symbol("failure");
      const result = fixture.telemetry.startSpan({ name: "work" }, () => {
        throw failure;
      });
      await expect(result).rejects.toBe(failure);
    },
  },
  {
    name: "records automatic ok on completion",
    async run(fixture) {
      await fixture.telemetry.startSpan({ name: "work" }, (span) => span.addEvent("worked"));
      expect(fixture.spans()[0]).toMatchObject({ status: { status: "ok" }, ended: true });
    },
  },
  {
    name: "records automatic error on throw and rejection",
    async run(fixture) {
      const failure = new Error("failure");
      await expect(
        fixture.telemetry.startSpan({ name: "throw" }, () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      await expect(
        fixture.telemetry.startSpan({ name: "reject" }, () => Promise.reject(failure)),
      ).rejects.toBe(failure);
      expect(fixture.spans().map((span) => [span.status, span.ended])).toEqual([
        [{ status: "error" }, true],
        [{ status: "error" }, true],
      ]);
    },
  },
  {
    name: "explicit status wins over completion and failure, with the last write winning",
    async run(fixture) {
      const failure = new Error("failure");
      const status = { status: "error" } as const;
      await fixture.telemetry.startSpan({ name: "complete" }, (span) => {
        span.setStatus({ status: "ok" });
        span.setStatus(status);
      });
      await expect(
        fixture.telemetry.startSpan({ name: "reject" }, (span) => {
          span.setStatus(status);
          span.setStatus({ status: "ok" });
          return Promise.reject(failure);
        }),
      ).rejects.toBe(failure);
      await expect(
        fixture.telemetry.startSpan({ name: "throw" }, (span) => {
          span.setStatus({ status: "ok" });
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(fixture.spans().map((span) => span.status)).toEqual([
        status,
        { status: "ok" },
        { status: "ok" },
      ]);
    },
  },
  {
    name: "merges attributes, ignoring undefined and replacing defined values",
    async run(fixture) {
      await fixture.telemetry.startSpan(
        { name: "work", attributes: { kept: 1, replaced: "old", absent: undefined } },
        (span) => {
          span.setAttributes({ kept: undefined, replaced: "new", added: false });
        },
      );
      expect(fixture.spans()[0]?.attributes).toEqual({ kept: 1, replaced: "new", added: false });
    },
  },
  {
    name: "keeps event order and attributes",
    async run(fixture) {
      await fixture.telemetry.startSpan({ name: "work" }, (span) => {
        span.addEvent("first", { count: 1, ignored: undefined });
        span.addEvent("second");
        span.addEvent("third", { done: true });
      });
      expect(fixture.spans()[0]?.events).toEqual([
        { name: "first", attributes: { count: 1 } },
        { name: "second", attributes: {} },
        { name: "third", attributes: { done: true } },
      ]);
    },
  },
  {
    name: "records nested parentage in start order across awaits",
    async run(fixture) {
      await fixture.telemetry.startSpan({ name: "parent" }, async (parent) => {
        await Promise.resolve();
        await parent.startSpan({ name: "child" }, (child) =>
          child.startSpan({ name: "grandchild" }, () => undefined),
        );
      });
      expect(fixture.spans().map((span) => [span.id, span.parentId, span.name])).toEqual([
        [1, undefined, "parent"],
        [2, 1, "child"],
        [3, 2, "grandchild"],
      ]);
    },
  },
  {
    name: "keeps concurrent siblings under their explicit parent",
    async run(fixture) {
      const gate = Promise.withResolvers<void>();
      await fixture.telemetry.startSpan({ name: "parent" }, async (parent) => {
        const first = parent.startSpan({ name: "first" }, () => gate.promise);
        try {
          await parent.startSpan({ name: "second" }, () => undefined);
          expect(fixture.open()).toEqual(["parent", "first"]);
        } finally {
          gate.resolve();
        }
        await first;
      });
      expect(fixture.spans().map((span) => [span.id, span.parentId, span.name])).toEqual([
        [1, undefined, "parent"],
        [2, 1, "first"],
        [3, 1, "second"],
      ]);
    },
  },
  {
    name: "stays open until the callback promise settles",
    async run(fixture) {
      const gate = Promise.withResolvers<void>();
      const result = fixture.telemetry.startSpan({ name: "work" }, async (span) => {
        await gate.promise;
        span.addEvent("settling");
      });
      try {
        await Promise.resolve();
        expect(fixture.open()).toEqual(["work"]);
      } finally {
        gate.resolve();
      }
      await result;
      expect(fixture.open()).toEqual([]);
      expect(fixture.spans()[0]?.events).toEqual([{ name: "settling", attributes: {} }]);
    },
  },
  {
    name: "ignores recording calls after settlement, including child admission",
    async run(fixture) {
      const span = await fixture.telemetry.startSpan({ name: "work" }, (active) => active);
      span.setAttributes({ late: true });
      span.addEvent("late");
      span.setStatus({ status: "error" });
      let calls = 0;
      expect(
        await span.startSpan({ name: "late" }, () => {
          calls += 1;
          return 42;
        }),
      ).toBe(42);
      expect(calls).toBe(1);
      expect(fixture.spans()).toEqual([
        {
          id: 1,
          parentId: undefined,
          name: "work",
          attributes: {},
          events: [],
          status: { status: "ok" },
          ended: true,
        },
      ]);
      expect(fixture.started()).toEqual(["work"]);
    },
  },
  {
    name: "records ok when the callback never calls a recording method",
    async run(fixture) {
      await fixture.telemetry.startSpan({ name: "work" }, () => undefined);
      expect(fixture.spans()).toEqual([
        {
          id: 1,
          parentId: undefined,
          name: "work",
          attributes: {},
          events: [],
          status: { status: "ok" },
          ended: true,
        },
      ]);
    },
  },
];
