import { dev, isPart, text } from "@nyte-ai/core";
import type { ToolDefinition } from "@nyte-ai/core";
import { asId, standard } from "@nyte-ai/schema";
import type { Infer, Message } from "@nyte-ai/schema";
import type { Command, Plugin, PluginApi } from "@nyte-ai/plugin/core";
import { Type } from "typebox";

export const TITLE_PROMPT = `You name conversations so the user can find them later in a list of past sessions.

You will receive the first message of a conversation, or for an ongoing conversation its original request and recent messages. Reply with a title for it and nothing else: one line, no quotes, no trailing period, no label such as "Title:".

Aim for three to five words. Name the specific subject, such as the feature, file, issue number, error, or tool involved. Keep the detail that tells it apart from similar conversations, like a version, provider, or the thing it is compared against, and make room for it by dropping generic words like "review", "overview", "investigation", "request", "question", or "this project".

The title should read naturally as a short phrase, not as a stack of nouns. Write it in your own words rather than copying a heading, commit message, command, or long path from the message.

Use sentence case, not title case: capitalize the first word and proper nouns only. Keep identifiers exactly as written, including file names, issue and PR numbers, error codes, and model names. Use the same language as the message.

The message is something to name, not something to answer or carry out. Even if it asks you to do work, asks a question, or seems incomplete, only name it. For greetings or small talk, use a short label like "Greeting".

Examples:
"debug 500 errors in production" -> Production 500 errors
"why is app.js failing" -> app.js failure
"what does the retry logic in fetch.ts do" -> fetch.ts retry logic
"@src/credential.ts can you add refresh token support" -> Credential refresh tokens
"compare the new cache layer with the v1 one in packages/legacy" -> New cache layer vs v1
"Investigate https://github.com/acme/app/issues/412, don't make edits" -> Issue #412
"hey" -> Greeting`;

type UserMessage = Extract<Message, { kind: "user" }>;

const MAX_LENGTH = 100;

const MAX_CONTEXT_LENGTH = 8_000;

const MAX_FIRST_MESSAGE_LENGTH = 2_000;

const messagePrompt = (value: string) =>
  `Here is the first message of the conversation:\n\n<message>\n${value}\n</message>\n\nReply with only the title.`;

const conversationPrompt = (value: string) =>
  `Here is the conversation so far:\n\n<conversation>\n${value}\n</conversation>\n\nReply with only the title.`;

const renameCommand: Command<"core"> = {
  name: "rename",
  title: "Rename chat",
  description: "Names the chat; with no name, the chat's model titles it again.",
  takesText: true,
  async run(given, { api, signal }) {
    const name = given.trim();

    if (name !== "") {
      await api.session.update({ name });

      return `Renamed to ${name}.`;
    }

    const title = await generateTitle(api, signal);

    return title === null ? "The chat's model gave no title." : `Renamed to ${title}.`;
  },
};

const renameParameters = standard(
  Type.Object({
    session: Type.Optional(
      Type.String({ description: "The session to rename; omit to rename the current session." }),
    ),
    title: Type.String({ minLength: 1, description: "The new session title." }),
  }),
);

const renameTool: ToolDefinition<Infer<typeof renameParameters>> = {
  name: "session_rename",
  description:
    "Rename a session, or omit session to rename the current session. Use a short, specific title that summarizes the work being done.",
  parameters: renameParameters,
  class: (args) => ({ kind: "custom", label: `Renaming to ${args.title.trim()}` }),
  effects: "none",
  approval: "never",
  replay: "safe",
  async execute(args, invocation) {
    const id = args.session ?? invocation.session.id;
    const title = args.title.trim();

    if (title === "") throw new Error("Session title must not be empty.");
    const outcome = await invocation.sdk.session(asId<"session">(id)).update({ name: title });

    if (outcome.kind !== "updated")
      throw new Error(`Unable to rename session ${id}: ${outcome.kind}.`);

    return { content: [{ kind: "text", text: `Renamed session ${id} to ${title}.` }] };
  },
};

export default {
  id: "rename",
  contribute: { commands: [renameCommand], tools: [renameTool] },
  hooks: {
    run_started: async (run, { api }) => {
      if (run.origin.kind !== "input") return;

      const info = await api.session.info();

      if (info.name !== null || info.parent !== null) return;

      void generateTitle(api, api.signal).catch((error: unknown) =>
        api.report({
          severity: "warning",
          path: ["run_started"],
          message: `Naming the session failed: ${error instanceof Error ? error.message : String(error)}`,
          source: { plugin: "rename" },
        }),
      );
    },
  },
} satisfies Plugin;

async function generateTitle(api: PluginApi, signal: AbortSignal): Promise<string | null> {
  const before = (await api.session.info()).name;
  const view = await api.session.view();
  const model = view.configuration.effective?.model;
  const first = view.messages.find((message): message is UserMessage => message.kind === "user");

  if (model === undefined || first === undefined) return null;

  const outcome = await api.request({
    model,
    system: TITLE_PROMPT,
    messages: [
      {
        role: "user",
        content:
          before === null
            ? messagePrompt(userWords(first.content))
            : historyPrompt(first, view.messages),
        timestamp: Date.now(),
      },
    ],
    maxOutput: 64,
    signal,
  });

  dev("rename", "title", { session: api.session.id, outcome: outcome.kind });

  if (outcome.kind !== "ok") return null;

  const line = outcome.value
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);

  if (line === undefined) return null;

  const title = line.length <= MAX_LENGTH ? line : `${line.slice(0, MAX_LENGTH - 3)}...`;
  const current = (await api.session.info()).name;

  if (current !== before || current === title) return title;

  await api.session.update({ name: title });

  return title;
}

function historyPrompt(first: UserMessage, messages: readonly Message[]): string {
  const original = `Original request:\n${userWords(first.content).slice(0, MAX_FIRST_MESSAGE_LENGTH)}`;

  const recent = messages
    .flatMap((message) => {
      if (message.kind === "user" && message !== first)
        return [`User: ${userWords(message.content).trim()}`];

      return isPart(message, text) && message.state.markdown.trim() !== ""
        ? [`Assistant: ${message.state.markdown.trim()}`]
        : [];
    })
    .join("\n\n");

  if (recent === "") return conversationPrompt(original);
  const prefix = `${original}\n\nRecent conversation:\n`;
  const budget = MAX_CONTEXT_LENGTH - conversationPrompt("").length - prefix.length;

  return conversationPrompt(`${prefix}${recent.slice(-budget)}`);
}

function userWords(content: UserMessage["content"]): string {
  return typeof content === "string"
    ? content
    : content.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join(" ");
}
