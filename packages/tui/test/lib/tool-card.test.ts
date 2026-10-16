import { describe, expect, test } from "bun:test";
import { asId } from "@nyte-ai/schema";
import type { Json, ToolClass, ToolPartState } from "@nyte-ai/sdk";
import { showsTool } from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import type { Task } from "../../src/lib/tasks.ts";
import { shellCard, toolCard } from "../../src/lib/tool-card.ts";
import type { ToolCardModel } from "../../src/lib/tool-card.ts";
import type { ShellJob } from "../../src/model/state.ts";
import { viewOf } from "../fixture/view.ts";
import type { TurnBuilder } from "../fixture/view.ts";

function toolOf(name: string, spec: Parameters<TurnBuilder["tool"]>[1]): ToolMessage {
  const view = viewOf((v) => v.turn("t1", (t) => t.user("go").tool(name, spec)));
  const message = view.messages.find((candidate) => showsTool(candidate));

  if (message === undefined || !showsTool(message)) throw new Error("no tool message");

  return message;
}

function withState(message: ToolMessage, state: ToolPartState): ToolMessage {
  return { ...message, state };
}

function text(card: ToolCardModel): string {
  return card.heading.map((chunk) => chunk.text).join("");
}

const PATCH: Json = {
  kind: "text",
  path: "src/a.ts",
  status: "modified",
  digest: "d",
  added: 1,
  removed: 1,
  hunks: [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      header: null,
      lines: [
        { kind: "remove", text: "const a = 1;" },
        { kind: "add", text: "const a = 2;" },
      ],
    },
  ],
};

const UNIFIED = [
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "+new",
  "@@ -10,1 +10,1 @@",
  "-ten",
  "+TEN",
].join("\n");

describe("toolCard", () => {
  test("a running call shows its progress inline, in the user colour", () => {
    const running = toolOf("search", { running: true });

    const card = toolCard(
      withState(running, { ...running.state, phase: "running", progress: { text: "scanning" } }),
      [],
      false,
    );

    expect(text(card)).toBe("● running search  scanning");
    expect(card.heading[0]?.role).toBe("user");
    expect(card.body).toEqual({ kind: "none" });
  });

  test("a settled call with many lines says how many and previews head and tail", () => {
    const card = toolCard(toolOf("search", { output: "1\n2\n3\n4\n5\n6\n7\n8" }), [], false);

    expect(text(card)).toBe("✓ ran search  8 lines");
    expect(card.body).toMatchObject({ kind: "text", role: "dim" });
    expect(card.body.kind === "text" ? card.body.text : "").toContain(
      "… 2 more lines · ctrl+o expand",
    );
  });

  test("expanded shows the whole output", () => {
    const card = toolCard(toolOf("search", { output: "1\n2\n3\n4\n5\n6\n7\n8" }), [], true);

    expect(card.body.kind === "text" ? card.body.text : "").toBe("1\n2\n3\n4\n5\n6\n7\n8");
  });

  test("a failure is red with the reason as its body", () => {
    const card = toolCard(toolOf("search", { failed: "boom" }), [], false);

    expect(text(card)).toBe("✗ search  boom · failed");
    expect(card.heading[0]?.role).toBe("error");
  });

  test("a stopped custom call keeps its label and says stopped", () => {
    const settled = toolOf("Search docs", {});

    const card = toolCard(
      withState(settled, {
        ...settled.state,
        phase: "settled",
        outcome: { kind: "stopped" },
        changes: null,
      }),
      [],
      false,
    );

    expect(text(card)).toBe("✗ Search docs  stopped");
    expect(card.heading[0]?.role).toBe("muted");
  });

  test("an edit that settled with a patch reports +added -removed and draws the patch", () => {
    const edit = toolOf("edit", { class: { kind: "edit", path: "src/a.ts" } });

    const card = toolCard(
      withState(edit, {
        ...edit.state,
        phase: "settled",
        outcome: { kind: "ok", content: [], output: PATCH, parts: [] },
        changes: { added: 1, removed: 1, paths: ["src/a.ts"] },
      }),
      [],
      false,
    );

    expect(text(card)).toBe("✓ edited src/a.ts  +1 -1");
    expect(card.body.kind).toBe("diff");

    if (card.body.kind !== "diff") return;
    expect(card.body.diff.files[0]?.path).toBe("src/a.ts");
    expect(card.body.diff.files[0]?.sections[0]?.pair).toEqual({
      removed: "const a = 1;",
      added: "const a = 2;",
      row: 0,
    });
  });

  test("a unified diff in any output counts its hunks and draws them", () => {
    const card = toolCard(toolOf("git", { output: UNIFIED }), [], false);

    expect(text(card)).toBe("✓ ran git  2 hunks");
    expect(card.body.kind).toBe("diff");
  });

  test("a collapsed read names the size and the key that expands it, with no body", () => {
    const read = toolOf("read", {
      class: { kind: "read", path: "src/a.ts" },
      output: "line 1\nline 2\nline 3",
    });

    expect(text(toolCard(read, [], false))).toBe("✓ read src/a.ts  3 lines · ctrl+o expand");
    expect(toolCard(read, [], false).body).toEqual({ kind: "none" });

    const expanded = toolCard(read, [], true);

    expect(text(expanded)).toBe("✓ read src/a.ts  3 lines");
    expect(expanded.body).toMatchObject({ kind: "text", filetype: "typescript" });
  });

  test("shell output previews its tail and names the earlier lines", () => {
    const shell = toolOf("bash", {
      class: { kind: "shell", command: "ls" },
      output: "1\n2\n3\n4\n5\n6\n7\n8",
    });

    const card = toolCard(shell, [], false);

    expect(text(card)).toContain("✓ ran ls  8 lines");
    expect(card.body.kind === "text" ? card.body.text : "").toContain(
      "… 2 earlier lines · ctrl+o expand",
    );
  });

  test("a delegation card finds its child by the call that created it", () => {
    const child = asId<"session">("child-1");

    const create = toolOf("task", {
      class: { kind: "delegate", role: "create", child: null, title: "explore" },
      running: true,
    });

    const childView = viewOf((v) =>
      v.turn("c1", (t) => t.user("look around").tool("grep", { running: true })).live(),
    );

    const task: Task = {
      kind: "agent",
      id: child,
      info: {
        id: child,
        name: "explorer",
        parent: asId("s1"),
        call: create.state.call,
        workspace: asId("w"),
        pinned: false,
        archived: false,
        activation: { kind: "active" },
        heads: [],
        createdAt: 0,
        lastActivityAt: 0,
      },
      view: childView,
    };

    const card = toolCard(create, [task], false);

    expect(text(card)).toBe("● explorer  model · medium");
    expect(card.body).toEqual({ kind: "activity", text: "running grep" });
    expect(text(toolCard(create, [{ ...task, info: { ...task.info, call: null } }], false))).toBe(
      "● explore",
    );
  });

  test("a call on a child is one line naming it", () => {
    const sendClass: ToolClass = {
      kind: "delegate",
      role: "send",
      child: asId("child-1"),
      title: null,
    };
    const send = toolOf("send", { class: sendClass, output: "" });
    const card = toolCard(send, [], false);

    expect(text(card)).toBe("✓ messaged subagent");
    expect(card.body).toEqual({ kind: "none" });
  });
});

describe("shellCard", () => {
  const job: ShellJob = {
    id: "j1",
    session: null,
    command: "ls -la",
    include: true,
    startedAt: 1_000,
    output: "a\nb\n",
    state: { kind: "running" },
    delivered: false,
  };

  test("a running command shows its clock", () => {
    expect(text(shellCard(job, 3_500, false))).toBe("● ! ls -la  2 lines · 2.5s");
  });

  test("the command is its own chunk, highlighted as bash", () => {
    expect(shellCard(job, 0, false).heading.slice(1, 3)).toEqual([
      { text: " ! ", role: "foreground" },
      { text: "ls -la", role: "foreground", code: "bash" },
    ]);
  });

  test("a private command reads !! and says its output is not sent", () => {
    const card = shellCard(
      { ...job, include: false, state: { kind: "exited", code: 0 } },
      0,
      false,
    );

    expect(text(card)).toBe("✓ !! ls -la  2 lines · not sent to model");
  });

  test("a failing exit, a signal and a cancel are red outcomes", () => {
    expect(text(shellCard({ ...job, state: { kind: "exited", code: 2 } }, 0, false))).toBe(
      "✗ ! ls -la  2 lines · exit 2",
    );
    expect(
      text(shellCard({ ...job, state: { kind: "signalled", signal: "SIGKILL" } }, 0, false)),
    ).toContain("SIGKILL");
    expect(shellCard({ ...job, state: { kind: "cancelled" } }, 0, false).body).toMatchObject({
      role: "error",
    });
  });
});
