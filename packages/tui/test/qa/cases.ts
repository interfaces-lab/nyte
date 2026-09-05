/**
 * The visual QA cases shared by the headless suite and `qa:show`.
 *
 * A case owns the same keystrokes and frame assertions in both modes. The show
 * runner adds pacing and observer chrome around them, so its reel cannot drift
 * into a hand-picked demo that misses a tested path.
 */
import assert from "node:assert/strict";
import { BUSY_COMPOSER_PLACEHOLDER } from "../../src/constants.ts";
import { SLASH_COMMANDS } from "../../src/slash.ts";
import type { Qa } from "./driver.ts";

export type QaCase =
  | {
      kind: "action";
      name: string;
      label: string;
      run: (qa: Qa) => Promise<void>;
    }
  | {
      kind: "exit";
      name: string;
      label: string;
      run: (qa: Qa) => Promise<void>;
    };

export interface QaSection {
  label: string;
  prepare: "keep" | "clear_draft";
  cases: readonly QaCase[];
}

export const RESUME_CASES: readonly QaCase[] = [
  {
    kind: "action",
    name: "the seeded transcript renders its tool cards and diff",
    label: "Render the saved transcript",
    run: async (qa) => {
      await qa.until((current) => current.includes("Resumed ·"));
      // Markdown lands a frame after the record does: syntax highlighting is async.
      const frame = await qa.until((current) => current.includes("Parses clean"));
      assert.match(frame, /✓ bash/);
      assert.match(frame, /\+ {3}if \(request\.url === "\/health" && request\.method === "GET"\)/);
    },
  },
  {
    kind: "action",
    name: "/resume lists the chat and marks it current",
    label: "Open the resume picker",
    run: async (qa) => {
      await qa.type("/resume");
      await qa.until((frame) => frame.includes("❯ /resume"));
      await qa.key("RETURN");
      const picker = await qa.until((frame) => frame.includes("Resume chat"));
      assert.match(picker, /Fix the health route \(current\)/);
      await qa.escape();
      assert.doesNotMatch(qa.frame(), /Resume chat/);
    },
  },
  {
    kind: "action",
    name: "/tree shows every turn and ctrl+u narrows to the user's",
    label: "Filter the session tree",
    run: async (qa) => {
      await qa.type("/tree");
      await qa.until((frame) => frame.includes("❯ /tree"));
      await qa.key("RETURN");
      const tree = await qa.until((frame) => frame.includes("Session tree"));
      assert.match(tree, /• user: the health probe is flaky/);
      assert.match(tree, /• assistant: Parses clean/);
      await qa.key("u", { ctrl: true });
      const users = await qa.until((frame) => frame.includes("│ users"));
      assert.doesNotMatch(users, /• assistant: Applying/);
      await qa.escape();
      assert.doesNotMatch(qa.frame(), /Session tree/);
    },
  },
  {
    kind: "action",
    name: "a double escape on a populated chat opens the tree",
    label: "Open the tree with escape",
    run: async (qa) => {
      await qa.key("ESCAPE");
      await qa.key("ESCAPE");
      await qa.until((frame) => frame.includes("Session tree"));
      await qa.escape();
      assert.doesNotMatch(qa.frame(), /Session tree/);
    },
  },
];

export const MENTION_CASES: readonly QaCase[] = [
  {
    kind: "action",
    name: "escape closes the file menu and keeps the draft",
    label: "Dismiss a file search",
    run: async (qa) => {
      await qa.type("@rea");
      await qa.until((frame) => frame.includes("README.md"));
      await qa.escape();
      const closed = qa.frame();
      assert.doesNotMatch(closed, /README\.md/);
      assert.match(closed, /❯ @rea/);
    },
  },
  {
    kind: "action",
    name: "tab folds the mention into a file tag",
    label: "Complete a file tag",
    run: async (qa) => {
      // Escape parks completion for the rest of that token; a fresh token reopens it.
      await qa.clear();
      await qa.type("@read");
      await qa.until((frame) => frame.includes("README.md"));
      await qa.key("TAB");
      await qa.until((frame) => frame.includes("[File README.md]"));
    },
  },
  {
    kind: "action",
    name: "a mention in the middle of a draft completes in place",
    label: "Complete a tag mid-draft",
    run: async (qa) => {
      await qa.type(" and  please");
      for (let index = 0; index < 7; index++) await qa.key("ARROW_LEFT");
      await qa.type("@serv");
      await qa.until((frame) => frame.includes("server.ts"));
      await qa.key("RETURN");
      const folded = await qa.until((frame) => frame.includes("[File server.ts]"));
      assert.match(folded, /\[File README\.md\].*and.*\[File server\.ts\].*please/);
    },
  },
];

export const CHAT_CASES: readonly QaCase[] = [
  {
    kind: "action",
    name: "a reply with reasoning shows the thought, then the answer",
    label: "Stream thought and answer",
    run: async (qa) => {
      await qa.submit("think about it");
      await qa.until((frame) => frame.includes("◆ Thought"));
      await qa.until((frame) => frame.includes("Here is the answer, with the reasoning above it"));
      assert.match(await qa.idle(), /Worked for/);
    },
  },
  {
    kind: "action",
    name: "a setting that recomposes the host keeps the live session wired",
    label: "Recompose the host",
    run: async (qa) => {
      await qa.type("/settings");
      await qa.key("RETURN");
      await qa.until((frame) => frame.includes("Settings  │"));
      await qa.key("ARROW_DOWN");
      await qa.key("ARROW_DOWN");
      await qa.key("RETURN");
      await qa.until((frame) => frame.includes("Auto-compact  │"));
      await qa.key("ARROW_DOWN");
      await qa.key("RETURN");
      await qa.until(
        (frame) =>
          frame.includes("Settings  │") && frame.includes("Auto-compact") && frame.includes("off"),
      );
      await qa.escape();

      await qa.submit("think after settings");
      assert.match(await qa.idle(), /Here is the answer, with the reasoning above it/);
    },
  },
  {
    kind: "action",
    name: "text paints while the model is still streaming",
    label: "Paint a long stream",
    run: async (qa) => {
      await qa.submit("long");
      const streaming = await qa.until(
        (frame) => frame.includes("Three things") && frame.includes(BUSY_COMPOSER_PLACEHOLDER),
      );
      assert.doesNotMatch(streaming, /What I would do next/);
      await qa.idle();
    },
  },
  {
    kind: "action",
    name: "a tool call renders its card and the follow-up answer",
    label: "Run a shell tool",
    run: async (qa) => {
      await qa.submit("bash echo hi");
      await qa.until((frame) => frame.includes("✓ bash echo hi  hi"));
      await qa.until((frame) => frame.includes("Done."));
      await qa.idle();
    },
  },
  {
    kind: "action",
    name: "escape stops a slow run",
    label: "Interrupt a slow run",
    run: async (qa) => {
      await qa.submit("slow");
      await qa.until((frame) => frame.includes("Three things"), 20_000);
      await qa.escape();
      const stopped = await qa.idle();
      assert.ok(
        stopped.lastIndexOf("What I would do next") < stopped.lastIndexOf("Three things"),
        "the interrupted reply must stop before its final section",
      );
    },
  },
  {
    kind: "action",
    name: "a failing provider settles into an error after its retries",
    label: "Retry a provider failure",
    run: async (qa) => {
      await qa.submit("fail please");
      const failed = await qa.idle(20_000);
      assert.match(failed, /Error: 500/);
      assert.match(failed, /sandbox: deliberate failure/);
    },
  },
  {
    kind: "action",
    name: "a double escape opens the tree once the chat has messages",
    label: "Open the live session tree",
    run: async (qa) => {
      await qa.key("ESCAPE");
      await qa.key("ESCAPE");
      const tree = await qa.until((frame) => frame.includes("Session tree"));
      assert.match(tree, /• user: think about it/);
      await qa.escape();
      assert.doesNotMatch(qa.frame(), /Session tree/);
    },
  },
];

const MENU = "Browse commands";

/** What each command shows on the seeded tools chat. */
const COMMAND_SURFACES: Readonly<Record<string, string>> = {
  help: "Commands  │",
  settings: "Settings  │",
  resume: "Resume chat",
  "name renamed": "Chat named renamed",
  title: "/title needs",
  login: "Provider  │",
  logout: "Provider  │",
  provider: "Provider  │",
  model: "Model  │",
  effort: "Thinking level",
  compact: "context compacted",
  usage: "No usage recorded",
  tree: "Session tree",
  edit: "Session tree",
  plugins: "Commands: /",
  reload: "then redrew the chat",
  update: "running from source",
  skills: "No skills found",
};

const COMMAND_SURFACE_CASES: readonly QaCase[] = Object.entries(COMMAND_SURFACES).map(
  ([invocation, expected]) => ({
    kind: "action",
    name: `/${invocation} reaches its surface and escape leaves it`,
    label: `Open /${invocation.split(" ")[0] ?? invocation}`,
    run: async (qa) => {
      await qa.clear();
      await qa.type(`/${invocation}`);
      await qa.until((frame) => frame.includes(`❯ /${invocation}`));
      await qa.key("RETURN");
      await qa.until((frame) => frame.includes(expected));
      await qa.escape();
      const after = qa.frame();
      assert.doesNotMatch(after, /type to filter/);
      assert.match(after, /❯ Plan, search, build anything/);
    },
  }),
);

export const QUIT_CASE: QaCase = {
  kind: "exit",
  name: "/quit ends the run with a quit exit",
  label: "Quit cleanly",
  run: async (qa) => {
    await qa.clear();
    await qa.type("/quit");
    await qa.until((frame) => frame.includes("❯ /quit"));
    await qa.key("RETURN");
    assert.deepEqual(await qa.exited, { kind: "quit" });
  },
};

export const SLASH_CASES_BEFORE_QUIT: readonly QaCase[] = [
  {
    kind: "action",
    name: "a slash at the start of the draft opens the menu; escape closes it and keeps the draft",
    label: "Open the command menu",
    run: async (qa) => {
      await qa.type("/");
      const open = await qa.until((frame) => frame.includes(MENU));
      // Ten rows, A to Z: the head of the registry is what an unfiltered menu shows.
      const names = SLASH_COMMANDS.map((command) => command.name).sort();
      for (const name of names.slice(0, 10)) assert.match(open, new RegExp(`/${name}\\b`));
      for (const name of names.slice(10)) assert.doesNotMatch(open, new RegExp(`/${name}\\b`));
      await qa.escape();
      const closed = qa.frame();
      assert.doesNotMatch(closed, /Browse commands/);
      assert.match(closed, /❯ \//);
    },
  },
  {
    kind: "action",
    name: "a slash token in the middle of a draft filters on what follows it",
    label: "Filter a command mid-draft",
    run: async (qa) => {
      await qa.clear();
      await qa.type("hello  world");
      for (let index = 0; index < 6; index++) await qa.key("ARROW_LEFT");
      await qa.type("/re");
      const open = await qa.until(
        (frame) => frame.includes("/resume") && frame.includes("/reload"),
      );
      assert.doesNotMatch(open, /\/help/);
      await qa.escape();
      const closed = qa.frame();
      assert.doesNotMatch(closed, /Resume a previous chat/);
      assert.match(closed, /❯ hello \/re world/);
    },
  },
  {
    kind: "action",
    name: "a slash token at the end of a draft completes without running",
    label: "Complete a slash command",
    run: async (qa) => {
      await qa.clear();
      await qa.type("say hi /he");
      await qa.until((frame) => frame.includes("/help"));
      await qa.key("TAB");
      const completed = await qa.until((frame) => frame.includes("❯ say hi /help"));
      assert.doesNotMatch(completed, /Commands {2}│/);
    },
  },
  {
    kind: "action",
    name: "the surface table covers the registry",
    label: "Check command coverage",
    run: async () => {
      const covered = Object.keys(COMMAND_SURFACES).map((invocation) => invocation.split(" ")[0]);
      assert.deepEqual(
        [...covered, "cd", "new", "quit"].sort(),
        SLASH_COMMANDS.map((command) => command.name).sort(),
      );
    },
  },
  ...COMMAND_SURFACE_CASES,
  {
    kind: "action",
    name: "/cd offers directories, and the current one is a no-op",
    label: "Browse directories",
    run: async (qa) => {
      await qa.clear();
      await qa.type("/cd .");
      // The argument opens a directory menu; Enter there completes, so close it first.
      await qa.until((frame) => frame.includes("../"));
      await qa.escape();
      await qa.key("RETURN");
      await qa.until((frame) => frame.includes("Already in"));
    },
  },
  {
    kind: "action",
    name: "/new starts an empty chat",
    label: "Start a new chat",
    run: async (qa) => {
      await qa.clear();
      assert.match(qa.frame(), /context compacted/);
      await qa.type("/new");
      await qa.until((frame) => frame.includes("❯ /new"));
      await qa.key("RETURN");
      await qa.until((frame) => !frame.includes("context compacted") && !frame.includes("Worked"));
      await qa.type("/tree");
      await qa.until((frame) => frame.includes("❯ /tree"));
      await qa.key("RETURN");
      await qa.until((frame) => frame.includes("No messages to branch from"));
    },
  },
];

export const SLASH_CASES: readonly QaCase[] = [...SLASH_CASES_BEFORE_QUIT, QUIT_CASE];

/**
 * `/new` closes the seeded command tour, then mentions and live chat use that
 * blank session. `/quit` stays last because it destroys the renderer.
 */
export const QA_SHOW_SECTIONS: readonly QaSection[] = [
  { label: "Resume", prepare: "keep", cases: RESUME_CASES },
  { label: "Commands", prepare: "keep", cases: SLASH_CASES_BEFORE_QUIT },
  { label: "Mentions", prepare: "keep", cases: MENTION_CASES },
  { label: "Chat", prepare: "clear_draft", cases: CHAT_CASES },
  { label: "Exit", prepare: "keep", cases: [QUIT_CASE] },
];
