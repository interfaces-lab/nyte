import { asId, asSeq, SdkError } from "@nyte-ai/schema";
import type { Json, PatchSetWire, ViewFrame } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { decodeInput, decodeOutput, encodeInput, encodeOutput } from "../src/index.ts";
import type { OperationInput, OperationOutput } from "../src/index.ts";

const session = asId<"session">("s1");
const head = asId<"head">("main");
const part = asId<"part">("p1");
const workspace = asId<"workspace">("w1");

function invalid(run: () => unknown): SdkError {
  try {
    run();
  } catch (error) {
    if (error instanceof SdkError) return error;
  }

  throw new Error("Expected an SdkError.");
}

describe("codec", () => {
  it("round-trips a sample of rows' inputs and outputs", () => {
    const send: OperationInput<"head.send"> = {
      session,
      head,
      content: [{ kind: "text", text: "Hi." }],
      options: { delivery: "queue", id: asId("r1") },
    };
    const watch: OperationInput<"head.watch"> = { session, head, options: { tail: 4 } };
    const patches: PatchSetWire = {
      revision: asId("g1"),
      entries: {
        "a.ts": { path: "a.ts", status: "added", digest: "d", kind: "binary", fresh: true },
      },
    };
    const frame: ViewFrame = {
      kind: "delta",
      seq: asSeq(3),
      revision: null,
      appends: [{ at: 0, append: "x", version: 2 }],
    };

    expect(decodeInput("head.send", encodeInput("head.send", send))).toEqual(send);
    expect(decodeInput("head.watch", encodeInput("head.watch", watch))).toEqual(watch);
    expect(decodeOutput("git.patches", encodeOutput("git.patches", patches))).toEqual(patches);
    expect(decodeOutput("head.watch", encodeOutput("head.watch", frame))).toEqual(frame);
    expect(
      decodeOutput(
        "receipt.status",
        encodeOutput("receipt.status", { kind: "settled", outcome: { kind: "withdrawn" } }),
      ),
    ).toEqual({ kind: "settled", outcome: { kind: "withdrawn" } });
    expect(decodeOutput("connection.blob", "aGk=")).toEqual(Uint8Array.of(104, 105));
  });

  it("rejects an unknown input field at any depth with its path", () => {
    const top = invalid(() => decodeInput("session.info", { session, extra: 1 }));
    const nested = invalid(() =>
      decodeInput("head.move", {
        session,
        head,
        position: { kind: "start", id: "x" },
        options: { running: "stop", fast: true },
      }),
    );
    const listed = invalid(() =>
      decodeInput("files.batch", {
        workspace,
        entries: [
          { kind: "remove", path: "a.ts" },
          { kind: "put", path: "b.ts", contents: "x", mode: 1 },
        ],
      }),
    );

    expect(top).toMatchObject({ code: "invalid" });
    expect(top.issues.map((issue) => issue.path)).toEqual([["extra"]]);
    expect(nested.issues.map((issue) => issue.path)).toEqual([
      ["position", "id"],
      ["options", "fast"],
    ]);
    expect(listed.issues.map((issue) => issue.path)).toEqual([["entries", 1, "mode"]]);
  });

  it("rejects an input failing its schema with the schema's issues", () => {
    const error = invalid(() => decodeInput("head.send", { session, head }));

    expect(error.code).toBe("invalid");
    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.issues[0]).toMatchObject({ severity: "error" });
  });

  it("accepts any JSON where a schema takes JSON, and a record's keys", () => {
    const input = {
      session,
      part,
      action: "pick",
      input: { anything: [{ goes: true }] },
    };

    expect(decodeInput("part.act", input)).toEqual(input);
    expect(
      decodeInput("settings.apply", { id: "core/theme", value: { nested: { deep: [1] } } }),
    ).toEqual({ id: "core/theme", value: { nested: { deep: [1] } } });
  });

  it("strips an output field its schema does not name, at any depth", () => {
    const outcome = {
      kind: "updated",
      version: 2,
      internal: "secret",
    } satisfies OperationOutput<"part.update"> & { readonly internal: string };
    const target = { kind: "local", path: "/repo", inode: 9 } as const;
    const info: OperationOutput<"workspace.info"> = {
      id: workspace,
      target,
      identity: asId<"environment-identity">("ei"),
      availability: { kind: "available" },
      projectResources: true,
      trusted: true,
      projectSources: [],
      addedBy: asId<"principal">("local"),
      sessions: 0,
      writers: [],
      isolation: null,
    };

    expect(encodeOutput("part.update", outcome)).toEqual({ kind: "updated", version: 2 });
    expect(encodeOutput("workspace.info", info)).toMatchObject({
      target: { kind: "local", path: "/repo" },
    });
    expect(encodeOutput("workspace.info", info)).not.toHaveProperty("target.inode");
  });

  it("never reads an inherited `__proto__` as a declared field, and keeps it as an own key when encoding (ADV G P3)", () => {
    const proto = (value: Json) => Object.fromEntries([["__proto__", value]]);
    const open = invalid(() =>
      decodeInput("browser.open", { workspace, url: "https://a.test", ...proto({}) }),
    );
    const batch = invalid(() =>
      decodeInput("files.batch", {
        workspace,
        entries: [{ kind: "remove", path: "a.ts", ...proto({}) }],
        ...proto({}),
      }),
    );
    const next = { ...proto({ x: 1 }), normal: 2 };
    const entry = {
      path: "a.ts",
      status: "added",
      digest: "d",
      kind: "binary",
      fresh: true,
    } as const;
    const patches: PatchSetWire = {
      revision: asId("g1"),
      entries: Object.fromEntries([["__proto__", entry]]),
    };

    expect(open.issues.map((issue) => issue.path)).toEqual([["__proto__"]]);
    expect(batch.issues.map((issue) => issue.path)).toEqual([
      ["entries", 0, "__proto__"],
      ["__proto__"],
    ]);
    expect(JSON.stringify(encodeInput("part.update", { session, part, next }))).toContain(
      '"next":{"__proto__":{"x":1},"normal":2}',
    );
    expect(JSON.stringify(encodeOutput("git.patches", patches))).toContain('"__proto__":{"path"');
  });

  it("skips an array record of an unknown kind, or one it cannot read, and keeps unknown fields when decoding", () => {
    const frame = [
      { path: "a.ts", version: null, kind: "created", rename: "b.ts" },
      { path: "c.ts", version: null, kind: "renamed" },
      { path: "d.ts", version: null, kind: "removed" },
    ];

    expect(decodeOutput("files.watch", frame)).toEqual([
      { path: "a.ts", version: null, kind: "created", rename: "b.ts" },
      { path: "d.ts", version: null, kind: "removed" },
    ]);
    expect(
      decodeOutput("files.watch", [
        { path: "a.ts" },
        { path: "d.ts", version: null, kind: "removed" },
      ]),
    ).toEqual([{ path: "d.ts", version: null, kind: "removed" }]);
    expect(() => decodeOutput("receipt.status", { kind: "settled" })).toThrow(SdkError);
  });
});
