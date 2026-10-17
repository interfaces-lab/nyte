import { readFileSync, readdirSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { HasCodec } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  IdentityChallengeSchema,
  JsonType,
  OutputFrameSchema,
  OutputFrameType,
  PartStatusSchema,
  RunEndType,
  SendOptionsSchema,
  SeqSchema,
  SeqType,
  SessionEventSchema,
  SessionIdSchema,
  SessionInfoType,
  ToolInfoSchema,
  OPERATIONS,
  actOutcomeSchema,
  asId,
  asSeq,
  idSchema,
  isJson,
  pagedSchema,
  stopOutcomeSchema,
} from "../src/index.ts";
import type {
  ActOutcome,
  IdentityChallenge,
  Json,
  Paged,
  PartStatus,
  RunEnd,
  Schema,
  SessionEvent,
  SessionId,
  SessionInfo,
  StopOutcome,
  ToolInfo,
} from "../src/index.ts";
import {
  sample,
  call,
  part,
  cursor,
  configuration,
  runEnd,
  sessionInfo,
  catalog,
  events,
} from "./cases/fixtures.ts";
import type { Case } from "./cases/fixtures.ts";
import { basicCases } from "./cases/basics.ts";
import { githubCases } from "./cases/github.ts";
import { operations } from "./cases/operations.ts";
import { sessionCases } from "./cases/session.ts";
import { workspaceCases } from "./cases/workspace.ts";

function ids(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(ids);

  if (typeof value !== "object" || value === null) return [];

  return Object.entries(value).flatMap(([key, entry]) =>
    key === "$id" && typeof entry === "string" ? [entry] : ids(entry),
  );
}

const cases = {
  ...operations,
  ...basicCases,
  ...workspaceCases,
  ...githubCases,
  ...sessionCases,
};

const paged: Schema<Paged<SessionInfo>> = pagedSchema(SessionInfoType);

const stopped: Schema<StopOutcome<RunEnd>> = stopOutcomeSchema(RunEndType);

const acted: Schema<ActOutcome<Json>> = actOutcomeSchema(JsonType);

const factories = {
  "pagedSchema(SessionInfoType)": sample(
    paged,
    { items: [sessionInfo], next: cursor },
    { items: [{}], next: null },
  ),
  "stopOutcomeSchema(RunEndType)": sample(
    stopped,
    { kind: "settled", outcome: runEnd },
    { kind: "settled" },
  ),
  "actOutcomeSchema(JsonType)": sample(
    acted,
    { kind: "ok", output: { picked: [1] } },
    { kind: "ok" },
  ),
} satisfies Record<string, Case>;

const wire = new URL("../src/", import.meta.url);

describe("wire schemas", () => {
  it("covers every exported schema", () => {
    const exported = readdirSync(wire)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) =>
        [
          ...readFileSync(new URL(file, wire), "utf8").matchAll(/^export const (\w+Schema)\b/gm),
        ].map((match) => match[1]),
      );

    const named = Object.keys(cases).filter((name) => !Object.hasOwn(operations, name));

    expect(named.toSorted()).toEqual(exported.toSorted());
  });

  it("covers every operation's input and output", () => {
    const covered = new Set(Object.values(cases).map((entry) => entry.schema));

    const missing = Object.entries(OPERATIONS).flatMap(([name, row]) =>
      covered.has(row.input) && covered.has(row.output) ? [] : [name],
    );

    expect(missing).toEqual([]);
  });

  it.each(Object.entries({ ...cases, ...factories }))(
    "%s validates, rejects and emits loadable JSON Schema",
    async (_name, { schema, good, bad, decoded }) => {
      const json = schema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
      const validator = new Validator(structuredClone(json), "2020-12");
      const found = ids(json);

      expect(await schema["~standard"].validate(good)).toEqual({ value: decoded ?? good });
      expect((await schema["~standard"].validate(bad)).issues?.length).toBeGreaterThan(0);
      expect(validator.validate(good).valid).toBe(true);

      if (isJson(bad)) expect(validator.validate(bad).valid).toBe(false);
      expect(new Set(found).size).toBe(found.length);
    },
  );

  it("types ids and seqs without codecs, so validating them runs no codec", async () => {
    const valid = await SessionIdSchema["~standard"].validate("s9");
    const decoded: SessionId | undefined = valid.issues === undefined ? valid.value : undefined;

    expect(HasCodec(idSchema<"session">())).toBe(false);
    expect(HasCodec(SeqType)).toBe(false);
    expect(HasCodec(OutputFrameType)).toBe(true);
    expect(decoded).toBe("s9");
    expect((await SeqSchema["~standard"].validate(1.5)).issues?.length).toBeGreaterThan(0);
  });

  it("returns what passes the check as TypeBox's typed Decode: the value itself without a codec", async () => {
    const [commit] = events.commit;
    const valid = await SessionEventSchema["~standard"].validate(commit);

    const kind: SessionEvent["kind"] | undefined =
      valid.issues === undefined ? valid.value.kind : undefined;

    expect(valid.issues === undefined ? valid.value : undefined).toBe(commit);
    expect(kind).toBe("commit");
  });

  it("carries output bytes as base64", async () => {
    expect(await OutputFrameSchema["~standard"].validate({ kind: "bytes", data: "aGk=" })).toEqual({
      value: { kind: "bytes", data: Uint8Array.of(104, 105) },
    });
  });

  it("accepts one session event of every durable kind and change", async () => {
    const all: readonly SessionEvent[] = Object.values(events).flat();

    for (const event of all) {
      expect(await SessionEventSchema["~standard"].validate(event)).toEqual({ value: event });
    }

    expect(new Set(all.map((event) => event.kind)).size).toBe(Object.keys(events).length);
  });

  it("round-trips a part waiting event through JSON and rejects one without a call id (§42ac)", async () => {
    const event: SessionEvent = {
      seq: asSeq(30),
      at: 1,
      head: null,
      kind: "part",
      part,
      change: "waiting",
      call,
    };

    const wire: unknown = JSON.parse(JSON.stringify(event));

    expect(await SessionEventSchema["~standard"].validate(wire)).toEqual({ value: event });
    expect(
      (await SessionEventSchema["~standard"].validate({ ...event, call: 7 })).issues?.length,
    ).toBeGreaterThan(0);
  });

  it("round-trips a live part status holding an early answer and rejects an answer without an action (§48i)", async () => {
    const status: PartStatus = {
      kind: "live",
      run: null,
      answer: { action: "answer", input: { choice: "yes" } },
    };

    const wire: unknown = JSON.parse(JSON.stringify(status));

    expect(await PartStatusSchema["~standard"].validate(wire)).toEqual({ value: status });
    expect(
      (await PartStatusSchema["~standard"].validate({ ...status, answer: { input: null } })).issues
        ?.length,
    ).toBeGreaterThan(0);
  });

  it("round-trips a tool's namespace through JSON, null or named, and rejects one that is neither (§48d)", async () => {
    const named: ToolInfo = {
      ...catalog.tools[0],
      name: "linear_search",
      owner: "mcp",
      namespace: "mcp/linear",
    };

    for (const info of [catalog.tools[0], named]) {
      const wire: unknown = JSON.parse(JSON.stringify(info));

      expect(await ToolInfoSchema["~standard"].validate(wire)).toEqual({ value: info });
    }

    const unnamed = {
      name: named.name,
      owner: named.owner,
      description: named.description,
      parameters: named.parameters,
      output: named.output,
      exposure: named.exposure,
    };

    expect((await ToolInfoSchema["~standard"].validate(unnamed)).issues?.length).toBeGreaterThan(0);
    expect(
      (await ToolInfoSchema["~standard"].validate({ ...named, namespace: 7 })).issues?.length,
    ).toBeGreaterThan(0);
  });

  it("round-trips an identity challenge with its host id and rejects one without it (§43k)", async () => {
    const challenge: IdentityChallenge = {
      hostId: asId("h1"),
      nonce: "n1",
      signature: "sig",
      publicKey: "key",
    };

    const wire: unknown = JSON.parse(JSON.stringify(challenge));

    expect(await IdentityChallengeSchema["~standard"].validate(wire)).toEqual({ value: challenge });
    expect(
      (await IdentityChallengeSchema["~standard"].validate({ ...challenge, hostId: 1 })).issues
        ?.length,
    ).toBeGreaterThan(0);
  });

  it("keeps an exact configuration whole where a patch is also accepted", async () => {
    expect(await SendOptionsSchema["~standard"].validate({ configuration })).toEqual({
      value: { configuration },
    });
    expect(isJson({ a: [1, null, { b: "c" }] })).toBe(true);
    expect(isJson(undefined)).toBe(false);
  });
});
