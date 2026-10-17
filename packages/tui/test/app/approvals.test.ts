import { expect, test } from "bun:test";
import type { Plugin, ToolDefinition } from "@nyte-ai/core";
import approvalsPlugin from "@nyte-ai/plugin/core/approvals";
import { openApprovals, PERMISSIONS } from "@nyte-ai/plugin/approvals/schema";
import { standard } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import { openTestHost } from "../fixture/host.ts";
import type { ProviderRequest } from "../fixture/host.ts";
import { startTui } from "../harness/tui.ts";
import type { Tui } from "../harness/tui.ts";

const ran: string[] = [];

const deploy = {
  name: "deploy",
  description: "Run a deploy command.",
  parameters: standard(Type.Object({ command: Type.String() })),
  class: (args) => ({ kind: "shell", command: args.command }),
  replay: "never",
  execute: async (args) => {
    ran.push(args.command);

    return { content: [{ kind: "text", text: `Ran ${args.command}.` }] };
  },
} satisfies ToolDefinition<{ command: string }>;

const tools: Plugin<"core"> = { id: "deploy", contribute: { tools: [deploy] } };

function toolCall(name: string, args: Readonly<Record<string, Json>>) {
  return {
    content: [{ type: "toolCall" as const, id: `call-${name}`, name, arguments: args }],
    stopReason: "toolUse" as const,
  };
}

const results = (request: ProviderRequest | undefined): string =>
  JSON.stringify(
    (request?.context.messages ?? []).flatMap((message) =>
      message.role === "toolResult" ? message.content : [],
    ),
  );

const row = (frame: string, text: string): string =>
  frame.split("\n").find((line) => line.includes(text)) ?? "";

const idle = (tui: Tui): Promise<void> => tui.state((store) => store.screen().run.kind === "idle");

async function asking(): Promise<Tui> {
  ran.length = 0;
  const fixture = await openTestHost({ plugins: [approvalsPlugin, tools] });
  expect(await fixture.host.settings.apply(PERMISSIONS, "ask")).toEqual({ kind: "applied" });

  const tui = await startTui({ fixture });
  await tui.ready();

  return {
    ...tui,
    [Symbol.asyncDispose]: async () => {
      await tui.dispose();
      await fixture.close();
    },
  };
}

test("an approval takes the keyboard on Deny, ↑ and Enter allow the call, and the run goes on", async () => {
  await using tui = await asking();
  tui.fixture.reply(toolCall("deploy", { command: "make deploy" }), {
    content: [{ type: "text", text: "Deployed it." }],
  });
  await tui.send("ship it");

  const asked = await tui.frame((frame) => frame.includes("Run this command?"));
  expect(asked).toContain("make deploy");
  expect(row(asked, "Deny")).toContain("❯");
  expect(row(asked, "Allow once")).not.toContain("❯");
  expect(asked).toContain("Allow for this session");
  expect(ran).toEqual([]);

  tui.press("picker.previous");
  await tui.frame((frame) => row(frame, "Allow for this session").includes("❯"));
  tui.press("picker.accept");
  await tui.frame(
    (frame) => frame.includes("Deployed it.") && !frame.includes("Run this command?"),
  );
  await idle(tui);

  expect(ran).toEqual(["make deploy"]);
  expect(results(tui.fixture.requests[1])).toContain("Ran make deploy.");
});

test("Esc on an approval denies the call and the model reads why", async () => {
  await using tui = await asking();
  tui.fixture.reply(toolCall("deploy", { command: "rm -rf build" }), {
    content: [{ type: "text", text: "Stopped there." }],
  });
  await tui.send("clean up");
  await tui.frame((frame) => frame.includes("Run this command?") && frame.includes("rm -rf build"));

  tui.press("picker.close");
  await tui.frame((frame) => frame.includes("Stopped there."));
  await idle(tui);

  expect(ran).toEqual([]);
  expect(results(tui.fixture.requests[1])).toContain(
    "The tool call was rejected: The user denied this tool call.",
  );
});

test("another client's answer closes the panel and the call runs", async () => {
  await using tui = await asking();
  tui.fixture.reply(toolCall("deploy", { command: "git push" }), {
    content: [{ type: "text", text: "Pushed." }],
  });
  await tui.send("push it");
  await tui.frame((frame) => frame.includes("Run this command?"));

  const [session] = (await tui.fixture.host.sessions.list()).items;

  if (session === undefined) throw new Error("No session started.");
  const watching = tui.fixture.host.session(session.id);
  const [open] = openApprovals(await watching.view());

  if (open === undefined) throw new Error("No approval is open.");
  expect(await watching.part(open.part).act("once", {})).toMatchObject({ kind: "ok" });
  await tui.frame((frame) => frame.includes("Pushed.") && !frame.includes("Run this command?"));
  await idle(tui);

  expect(ran).toEqual(["git push"]);
});

test("/permissions sets the policy by name and lists it with the current one marked", async () => {
  await using tui = await asking();
  await tui.send("/permissions auto-edit");
  await tui.state((store) =>
    store
      .state()
      .facts.hostSettings.some(
        (setting) => setting.id === PERMISSIONS && setting.value === "auto-edit",
      ),
  );

  for await (const view of tui.fixture.host.watch()) {
    expect(view.settings.find((setting) => setting.id === PERMISSIONS)?.value).toBe("auto-edit");
    break;
  }

  await tui.send("/permissions");
  const listed = await tui.frame((frame) => row(frame, "Auto-edit").includes("❯"));
  expect(listed).toContain("Ask first");
  expect(listed).toContain("Full access");
});
