import { expect, test } from "bun:test";
import type { Plugin } from "@nyte-ai/core";
import { chatOnly } from "@nyte-ai/bench";
import { asId } from "@nyte-ai/schema";
import { COMPOSER_PLACEHOLDER } from "../../src/lib/constants.ts";
import { openTestHost } from "../fixture/host.ts";
import { belowComposer, composerShows, startTui } from "../harness/tui.ts";
import type { Tui } from "../harness/tui.ts";

async function answered(tui: Tui, text: string, question = "hi nyte"): Promise<void> {
  tui.fixture.reply({ content: [{ type: "text", text }] });
  await tui.send(question);
  await tui.frame((frame) => frame.includes(text));
  await tui.state((store) => store.screen().run.kind === "idle");
}

test("/usage opens under the composer: nothing before a reply, the reply's tokens after; Ctrl+C closes it", async () => {
  await using tui = await startTui();
  await tui.ready();

  await tui.send("/usage");
  await tui.frame((frame) => belowComposer(frame, "Usage") && frame.includes("No usage recorded"));
  tui.press("picker.close");
  await tui.frame((frame) => !belowComposer(frame, "Usage"));

  await answered(tui, "Hello from the fake provider.");
  await tui.send("/usage");
  const shown = await tui.frame((frame) => belowComposer(frame, "this chat · 15 tokens"));

  expect(shown).toContain("input 10 · output 5");
  expect(shown).toContain("Hello from the fake provider.");
  tui.press("chat.quit");
  await tui.frame(
    (frame) => !belowComposer(frame, "Usage") && composerShows(frame, COMPOSER_PLACEHOLDER),
  );
  expect(tui.fixture.requests).toHaveLength(1);
});

test("every slash menu opens under the composer and closes without sending", async () => {
  await using tui = await startTui();
  await tui.ready();
  await answered(tui, "Hello from the fake provider.");

  for (const [name, title] of [
    ["help", "Commands"],
    ["settings", "Settings"],
    ["model", "Models"],
    ["theme", "Theme"],
    ["follow-up", "Follow-up behavior"],
    ["resume", "Resume chat"],
    ["tasks", "Tasks"],
    ["tree", "Chat Tree"],
    ["edit", "Chat Tree"],
    ["plugins", "Plugins"],
    ["accounts", "Accounts"],
    ["login", "Sign in to a provider"],
    ["logout", "Remove a stored credential"],
  ] as const) {
    await tui.send(`/${name}`);

    const shown = await tui.frame(
      (frame) => belowComposer(frame, title) && composerShows(frame, COMPOSER_PLACEHOLDER),
    );

    expect(shown).toContain("Hello from the fake provider.");
    tui.press("picker.close");
    await tui.frame((frame) => !belowComposer(frame, title));
  }

  await tui.send("/help");
  await tui.frame((frame) => belowComposer(frame, "Commands"));
  tui.press("picker.accept");
  await tui.frame(
    (frame) => belowComposer(frame, "Keyboard shortcuts") && !belowComposer(frame, "Commands"),
  );
  tui.press("picker.close");
  await tui.frame((frame) => !belowComposer(frame, "Keyboard shortcuts"));
  expect(tui.fixture.requests).toHaveLength(1);
  expect(tui.store.screen().run.kind).toBe("idle");
});

test("a blank chat in a trusted folder offers its project plugin's command and runs it before any message", async () => {
  const loaded: string[] = [];

  const probe: Plugin<"core"> = {
    id: "qa-probe",
    activate(api) {
      api.contribute.commands.add({
        name: "qa-probe",
        title: "QA probe",
        description: "Show that the project plugin loaded",
        run: () => "QA plugin answered",
      });
    },
  };

  await using fixture = await openTestHost({
    environment: {
      id: "folder",
      environment: {
        kind: "local",
        inspect: async () => ({
          identity: asId("folder"),
          availability: { kind: "available" },
          projectSources: [".nyte/plugins/qa-probe"],
        }),
        attach: (target) => {
          const base = chatOnly.environment;

          if (base === undefined) throw new Error("chatOnly provides no environment.");

          return base.attach(target);
        },
      },
    },
    workspace: { kind: "local", path: "/work/project" },
    loadPlugins: async (paths) => {
      loaded.push(...paths);

      return [probe];
    },
  });

  const [workspace] = await fixture.host.workspaces.list();

  if (workspace === undefined) throw new Error("The host registered no workspace.");
  await fixture.host.workspace(workspace.id).update({ projectResources: true });

  await using tui = await startTui({ fixture });
  await tui.ready();
  await tui.mockInput.typeText("/qa-probe");
  await tui.frame((frame) => belowComposer(frame, "Show that the project plugin loaded"));
  tui.press("chat.submit");
  await tui.frame((frame) => frame.includes("QA plugin answered"));

  expect(loaded).toContain("/work/project/.nyte/plugins/qa-probe");
  expect(tui.store.state().facts.chat?.kind).toBe("blank");
  expect((await fixture.host.sessions.list()).items).toEqual([]);
  expect(fixture.requests).toHaveLength(0);
});

test("settings lists the thinking level and Esc closes it", async () => {
  await using tui = await startTui();
  await tui.ready();

  await tui.send("/settings");
  await tui.frame(
    (frame) =>
      belowComposer(frame, "Settings") &&
      frame.split("\n").some((line) => /thinking level/iu.test(line)),
  );
  tui.press("picker.close");
  await tui.frame(
    (frame) => !belowComposer(frame, "Settings") && composerShows(frame, COMPOSER_PLACEHOLDER),
  );
});

test("/tree opens under the composer, Enter on the latest message says it is already there, Esc closes it", async () => {
  await using tui = await startTui();
  await tui.ready();
  await answered(tui, "Hello from the fake provider.");

  await tui.send("/tree");
  await tui.frame((frame) => belowComposer(frame, "Chat Tree"));
  tui.press("picker.accept");
  await tui.frame((frame) => belowComposer(frame, "Already at that point in the chat"));
  tui.press("tree.close");
  await tui.frame(
    (frame) => !frame.includes("Chat Tree") && composerShows(frame, COMPOSER_PLACEHOLDER),
  );
});

/** The tree's visible rows, from the pointer column, between its filter line and its `(n/total)` footer. */
function treeWindow(frame: string): string[] {
  const lines = frame.split("\n").map((line) => line.trimEnd());
  const title = lines.find((line) => line.trim() === "Chat Tree") ?? "";
  const margin = title.length - title.trimStart().length;
  const top = lines.findIndex((line) => line.trim() === "type to filter");

  const footer = lines.findIndex(
    (line, index) => index > top && /^\(\d+\/\d+\)/u.test(line.trim()),
  );

  return lines.slice(top + 1, footer).map((line) => line.slice(margin));
}

test("the tree holds its pointer mid-window: opened on the current message, moved by keys or the wheel, clamped at the ends", async () => {
  await using tui = await startTui({ size: { width: 100, height: 24 } });
  await tui.ready();

  for (const turn of ["1", "2", "3", "4", "5"])
    await answered(tui, `answer ${turn}`, `question ${turn}`);

  tui.press("chat.interrupt");
  tui.press("chat.interrupt");

  expect(treeWindow(await tui.frame((frame) => frame.includes("(10/10)")))).toEqual([
    "  • user: question 3",
    "  • assistant: answer 3",
    "  • user: question 4",
    "  • assistant: answer 4",
    "  • user: question 5",
    "❯ • assistant: answer 5",
  ]);

  for (let press = 0; press < 5; press++) tui.press("picker.previous");

  expect(treeWindow(await tui.frame((frame) => frame.includes("(5/10)")))).toEqual([
    "  • assistant: answer 1",
    "  • user: question 2",
    "  • assistant: answer 2",
    "❯ • user: question 3",
    "  • assistant: answer 3",
    "  • user: question 4",
  ]);

  tui.press("picker.accept");
  await tui.frame((frame) => frame.includes("Summarize the branch you are leaving?"));
  tui.press("picker.accept");
  await tui.frame((frame) => composerShows(frame, "question 3"));
  tui.press("chat.quit");
  await tui.frame((frame) => composerShows(frame, COMPOSER_PLACEHOLDER));
  await answered(tui, "answer 3 again", "question 3 again");

  tui.press("chat.interrupt");
  tui.press("chat.interrupt");
  const branched = await tui.frame((frame) => frame.includes("(6/12)"));

  expect(treeWindow(branched)).toEqual([
    "  • user: question 2",
    "  • assistant: answer 2",
    "  ├⊟ • user: question 3 again",
    "❯ │     • assistant: answer 3 again",
    "  └⊟ user: question 3",
    "        assistant: answer 3",
  ]);

  await tui.mockMouse.scroll(
    10,
    branched.split("\n").findIndex((line) => line.includes("• assistant: answer 3 again")),
    "up",
  );

  expect(treeWindow(await tui.frame((frame) => frame.includes("(5/12)")))).toEqual([
    "  • assistant: answer 1",
    "  • user: question 2",
    "  • assistant: answer 2",
    "❯ ├⊟ • user: question 3 again",
    "  │     • assistant: answer 3 again",
    "  └⊟ user: question 3",
  ]);

  tui.press("tree.page.up");

  expect(treeWindow(await tui.frame((frame) => frame.includes("(1/12)")))).toEqual([
    "❯ • user: question 1",
    "  • assistant: answer 1",
    "  • user: question 2",
    "  • assistant: answer 2",
    "  ├⊟ • user: question 3 again",
    "  │     • assistant: answer 3 again",
  ]);
});

test("/accounts switches the login the next request uses, without asking the provider", async () => {
  await using fixture = await openTestHost();

  for (const [label, key] of [
    ["Primary", "sk-primary"],
    ["Secondary", "sk-secondary"],
  ] as const)
    await fixture.models.models.login(
      "test",
      "api_key",
      { prompt: async () => key, notify: () => undefined },
      label,
    );
  await fixture.models.models.selectAccount(
    "test",
    (await fixture.models.models.listAccounts("test")).find(
      (account) => account.label === "Primary",
    )?.id ?? "",
  );
  await using tui = await startTui({ fixture });
  await tui.ready();

  await tui.send("/accounts");
  await tui.frame(
    (frame) =>
      belowComposer(frame, "Primary") &&
      belowComposer(frame, "Secondary") &&
      frame.split("\n").some((line) => /❯.*Primary/u.test(line)),
  );
  tui.press("picker.next");
  await tui.frame((frame) => frame.split("\n").some((line) => /❯.*Secondary/u.test(line)));
  tui.press("picker.accept");
  await tui.frame((frame) => frame.includes("Using Secondary."));

  const active = (await fixture.models.models.listAccounts("test")).find(
    (account) => account.active,
  );

  expect(active?.label).toBe("Secondary");
  expect(fixture.requests).toHaveLength(0);
});
