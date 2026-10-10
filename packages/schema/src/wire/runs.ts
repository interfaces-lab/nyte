import { Type } from "typebox";
import type { TSchema } from "typebox";
import type {
  BackgroundItem,
  Execution,
  RunEnd,
  RunView,
  WaitOutcome,
  WaitTarget,
} from "../runs.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { ConfigurationType } from "./configuration.ts";
import { FailureType } from "./errors.ts";
import { idSchema } from "./ids.ts";
import { JobEndType } from "./jobs.ts";
import { JsonType, cyclicWithJson, withJson } from "./json.ts";
import { UsageType } from "./models.ts";
import { nullable } from "./nullable.ts";

/** The TypeBox schema of a `RunView`. */
export const RunViewType = Type.Object({
  id: idSchema<"run">(),
  head: idSchema<"head">(),
  startedAt: Type.Number(),
  attempt: Type.Number(),
  configuration: ConfigurationType,
  origin: Type.Union([
    Type.Object({ kind: Type.Literal("input"), message: idSchema<"message">() }),
    Type.Object({ kind: Type.Literal("continuation"), from: Type.Enum(["child", "job", "wake"]) }),
  ]),
});

/** The TypeBox schema of a `RunEnd`. */
export const RunEndType = Type.Union([
  Type.Object({ kind: Type.Literal("completed"), usage: UsageType }),
  Type.Object({ kind: Type.Literal("stopped") }),
  Type.Object({ kind: Type.Literal("failed"), failure: FailureType }),
]);

const DEADLINE = { deadline: Type.Optional(Type.Number()) };

/** The TypeBox schema of a `WaitTarget`. */
export const WaitTargetType = Type.Union([
  Type.Object({
    ...DEADLINE,
    kind: Type.Literal("run"),
    session: idSchema<"session">(),
    run: idSchema<"run">(),
  }),
  Type.Object({ ...DEADLINE, kind: Type.Literal("job"), job: idSchema<"job">() }),
  Type.Object({ ...DEADLINE, kind: Type.Literal("part"), part: idSchema<"part">() }),
  Type.Object({ ...DEADLINE, kind: Type.Literal("timer"), until: Type.Number() }),
]);

/** The TypeBox schema of an `Execution`. */
export const ExecutionType = Type.Union([
  Type.Object({
    kind: Type.Literal("idle"),
    lastRun: nullable(
      Type.Object({ id: idSchema<"run">(), end: RunEndType, endedAt: Type.Number() }),
    ),
  }),
  Type.Object({
    kind: Type.Literal("live"),
    run: RunViewType,
    phase: Type.Enum(["responding", "executing"]),
    stopping: Type.Boolean(),
  }),
  Type.Object({ kind: Type.Literal("waiting"), run: RunViewType, on: WaitTargetType }),
  Type.Object({
    kind: Type.Literal("retrying"),
    run: RunViewType,
    until: Type.Number(),
    reason: Type.String(),
  }),
]);

/** The TypeBox schema of a `BackgroundItem`. */
export const BackgroundItemType = Type.Object({
  kind: Type.Enum(["child", "job", "page"]),
  id: Type.String(),
  title: Type.String(),
  state: Type.Enum(["working", "waiting", "done", "failed"]),
  startedBy: nullable(idSchema<"call">()),
});

/** The TypeBox schema of a `WaitOutcome`; `all` refers to `WaitOutcome` by name, so it resolves beneath a root that defines it, as `WaitOutcomeSchema` does. */
export const WaitOutcomeType = Type.Union([
  Type.Object({
    kind: Type.Literal("run"),
    session: idSchema<"session">(),
    run: idSchema<"run">(),
    end: RunEndType,
  }),
  Type.Object({ kind: Type.Literal("job"), job: idSchema<"job">(), end: JobEndType }),
  Type.Object({
    kind: Type.Literal("part"),
    part: idSchema<"part">(),
    answer: nullable(Type.Object({ action: Type.String(), input: JsonType })),
  }),
  Type.Object({ kind: Type.Literal("timer") }),
  Type.Object({ kind: Type.Literal("deadline") }),
  Type.Object({ kind: Type.Literal("input"), message: idSchema<"message">() }),
  Type.Object({ kind: Type.Literal("all"), outcomes: Type.Array(Type.Ref("WaitOutcome")) }),
  Type.Object({ kind: Type.Literal("stopped") }),
]);

/** Returns the schema of a `StopOutcome` whose settled outcome is `outcome`. */
export function stopOutcomeSchema<T extends TSchema>(outcome: T) {
  return standard(
    withJson(
      Type.Union([
        Type.Object({ kind: Type.Literal("requested") }),
        Type.Object({ kind: Type.Literal("settled"), outcome }),
        Type.Object({ kind: Type.Literal("missing") }),
      ]),
    ),
  );
}

/** Validates a `RunView`. */
export const RunViewSchema: Schema<RunView> = standard(withJson(RunViewType));

/** Validates a `RunEnd`. */
export const RunEndSchema: Schema<RunEnd> = standard(RunEndType);

/** Validates a `WaitTarget`. */
export const WaitTargetSchema: Schema<WaitTarget> = standard(WaitTargetType);

/** Validates an `Execution`. */
export const ExecutionSchema: Schema<Execution> = standard(withJson(ExecutionType));

/** Validates a `BackgroundItem`. */
export const BackgroundItemSchema: Schema<BackgroundItem> = standard(BackgroundItemType);

/** Validates a `WaitOutcome`. */
export const WaitOutcomeSchema: Schema<WaitOutcome> = standard(
  cyclicWithJson({ WaitOutcome: WaitOutcomeType }, "WaitOutcome"),
);
