import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { testRenderer } from "../test/renderer.ts";

const Values = Type.Array(Type.Union([Type.Number(), Type.Null()]));

const Cleared = Type.Object({ queued: Type.Number(), pending: Type.Number(), rendered: Values });

const Report = Type.Object({
  first: Type.Object({ heard: Values, rendered: Values, shown: Type.String() }),
  burst: Type.Object({
    heard: Values,
    beforeFlush: Type.Object({ heard: Type.Number(), rendered: Type.Number() }),
    rendered: Values,
    commits: Type.Number(),
    shown: Type.String(),
  }),
  perFrame: Type.Object({ commits: Type.Number(), shown: Type.String() }),
  hidden: Type.Object({
    early: Values,
    late: Values,
    shown: Type.String(),
    pending: Type.Number(),
  }),
  retry: Type.Intersect([Cleared, Type.Object({ rescheduled: Type.Number(), afterFrame: Values })]),
  dispose: Type.Intersect([Cleared, Type.Object({ afterFrame: Values, shown: Type.String() })]),
});

test(
  "watch listeners hear every value at once while React hears one notice a frame",
  { timeout: 120_000 },
  async () => {
    const output = await testRenderer(
      new URL("./watch-notifications.browser-test.tsx", import.meta.url),
    );

    const report = Value.Parse(Report, JSON.parse(output));
    console.info(`watch notifications: ${JSON.stringify(report)}`);

    expect(report.first).toEqual({ heard: [0], rendered: [0], shown: "0" });

    expect(report.burst).toEqual({
      heard: [1, 2, 3, 4, 5],
      beforeFlush: { heard: 5, rendered: 0 },
      rendered: [5],
      commits: 1,
      shown: "5",
    });

    expect(report.perFrame).toEqual({ commits: 3, shown: "8" });
    expect(report.hidden).toEqual({ early: [], late: [9], shown: "9", pending: 0 });

    expect(report.retry).toEqual({
      queued: 1,
      pending: 0,
      rendered: [10],
      rescheduled: 1,
      afterFrame: [10, 11],
    });

    expect(report.dispose).toEqual({
      queued: 1,
      pending: 0,
      rendered: [null],
      afterFrame: [null],
      shown: "none",
    });
  },
);
