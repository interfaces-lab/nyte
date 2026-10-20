import { dev, isPart, text } from "@nyte-ai/core";
import type { Message } from "@nyte-ai/schema";
import type { Command, Plugin, PluginApi } from "@nyte-ai/plugin/core";

/**
 * The instruction a title request runs under: one short line in the user's
 * language, naming what the conversation is about.
 *
 * @category plugins
 * @since 0.1.0
 */
export const TITLE_PROMPT = `You write the title of a conversation so the user can find it later.
Answer with one line of at most 50 characters and nothing else, in the language of the user's request.
Name the topic or task, keep technical terms, numbers and file names exact, and never answer the request itself.`;

const NAME_LIMIT = 100;

const renameCommand: Command<"core"> = {
  name: "rename",
  title: "Rename chat",
  description: "Names the chat; with no name, the chat's model titles it again.",
  takesText: true,
  async run(given, { api, signal }) {
    const name = given === "" ? await requestTitle(api, signal) : given.slice(0, NAME_LIMIT);
    await api.session.update({ name });

    return `Renamed to ${name}.`;
  },
};

/**
 * Names an unnamed root session as its first run starts: the first line of
 * the user's message at once, then the title one `api.request` to the
 * session's model returns, alongside the run. The title replaces only that
 * first line, so a name given meanwhile stays. A named session or a child
 * keeps its name, so every later run is a no-op. The request runs past the
 * hook's budget, bounded by the plugin's deactivation; a failure is reported
 * and leaves the first line as the name. `/rename <name>` names the chat;
 * `/rename` alone asks the model again.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "rename",
  contribute: { commands: [renameCommand] },
  hooks: {
    run_started: (run, { api }) => {
      if (run.origin.kind !== "input") return;

      void nameUnnamed(api).catch((error: unknown) =>
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

async function nameUnnamed(api: PluginApi): Promise<void> {
  const info = await api.session.info();

  if (info.name !== null || info.parent !== null) return;

  const view = await api.session.view();

  const words = view.messages.flatMap((message) =>
    message.kind === "user" ? [userWords(message.content)] : [],
  )[0];

  const firstLine = words
    ?.split("\n")
    .find((line) => line.trim() !== "")
    ?.trim()
    .slice(0, NAME_LIMIT);

  if (firstLine === undefined) return;

  await api.session.update({ name: firstLine });

  const title = await requestTitle(api, api.signal);

  if ((await api.session.info()).name !== firstLine) return;

  await api.session.update({ name: title });
}

async function requestTitle(api: PluginApi, signal: AbortSignal): Promise<string> {
  const view = await api.session.view();
  const model = view.configuration.effective?.model;
  const conversation = transcript(view.messages);

  if (model === undefined) throw new Error("The chat has no model to title it.");

  if (conversation === "") throw new Error("Send a message before titling the chat.");

  const outcome = await api.request({
    model,
    system: TITLE_PROMPT,
    messages: [{ role: "user", content: conversation, timestamp: Date.now() }],
    maxOutput: 64,
    signal,
  });

  dev("rename", "title", { session: api.session.id, outcome: outcome.kind });

  if (outcome.kind === "refused") throw new Error(outcome.reason);

  if (outcome.kind === "failed") throw new Error(outcome.failure.message);

  const name = outcome.value
    .split("\n")
    .find((line) => line.trim() !== "")
    ?.trim()
    .slice(0, NAME_LIMIT);

  if (name === undefined) throw new Error("The model answered with no title.");

  return name;
}

function transcript(messages: readonly Message[]): string {
  return messages
    .flatMap((message) => {
      if (message.kind === "user") return [`User: ${userWords(message.content)}`];

      return isPart(message, text) ? [`Assistant: ${message.state.markdown}`] : [];
    })
    .join("\n\n")
    .slice(0, 4000);
}

function userWords(content: Extract<Message, { kind: "user" }>["content"]): string {
  return typeof content === "string"
    ? content
    : content.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join(" ");
}
