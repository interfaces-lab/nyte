import { Type } from "typebox";
import type { TSchema } from "typebox";
import { FailureType } from "./errors.ts";
import { idSchema } from "./ids.ts";
import { JobEndType } from "./jobs.ts";
import { cyclicWithJson, JsonType, withJson } from "./json.ts";
import { UsageType } from "./models.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

export const RunViewType = Type.Object({
  id: idSchema<"run">(),
  head: idSchema<"head">(),
  startedAt: Type.Number(),
  attempt: Type.Number(),
  origin: Type.Union([
    Type.Object({ kind: Type.Literal("input"), message: idSchema<"message">() }),
    Type.Object({ kind: Type.Literal("continuation"), from: Type.Enum(["child", "job", "wake"]) }),
  ]),
});

export type RunView = Decoded<typeof RunViewType>;

export const RunEndType = Type.Union([
  Type.Object({ kind: Type.Literal("completed"), usage: UsageType }),
  Type.Object({ kind: Type.Literal("stopped") }),
  Type.Object({ kind: Type.Literal("failed"), failure: FailureType }),
]);

export type RunEnd = Decoded<typeof RunEndType>;

const DEADLINE = { deadline: Type.Optional(Type.Number()) };

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

export type WaitTarget = Decoded<typeof WaitTargetType>;

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

export type Execution = Decoded<typeof ExecutionType>;

export const BackgroundItemType = Type.Object({
  kind: Type.Enum(["child", "job", "page"]),
  id: Type.String(),
  title: Type.String(),
  state: Type.Enum(["working", "waiting", "done", "failed"]),
  startedBy: nullable(idSchema<"call">()),
});

export type BackgroundItem = Decoded<typeof BackgroundItemType>;

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

const WAIT_OUTCOME = cyclicWithJson({ WaitOutcome: WaitOutcomeType }, "WaitOutcome");

export type WaitOutcome = Decoded<typeof WAIT_OUTCOME>;

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

export const RunViewSchema: Schema<RunView> = standard(withJson(RunViewType));

export const RunEndSchema: Schema<RunEnd> = standard(RunEndType);

export const WaitTargetSchema: Schema<WaitTarget> = standard(WaitTargetType);

export const ExecutionSchema: Schema<Execution> = standard(withJson(ExecutionType));

export const BackgroundItemSchema: Schema<BackgroundItem> = standard(BackgroundItemType);

export const WaitOutcomeSchema: Schema<WaitOutcome> = standard(WAIT_OUTCOME);

export type StopOutcome<O> =
  | { readonly kind: "requested" }
  | { readonly kind: "settled"; readonly outcome: O }
  | { readonly kind: "missing" };
