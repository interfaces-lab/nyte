import { dev, isPart, text } from "@nyte-ai/core";
import type { Message } from "@nyte-ai/schema";
import type { Plugin, PluginApi } from "./core.ts";

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

/**
 * Names an unnamed root session after its first run: one `api.request` to
 * the session's model for a title, then `session.update({ name })`. A named
 * session, a child, or a failed request leaves the name alone, so every
 * later run is a no-op. The request runs past the hook's budget, bounded by
 * the plugin's deactivation; a failure is reported.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "rename",
  hooks: {
    run_ended: (_end, { api }) => {
      void title(api).catch((error: unknown) =>
        api.report({
          severity: "warning",
          path: ["run_ended"],
          message: `Naming the session failed: ${error instanceof Error ? error.message : String(error)}`,
          source: { plugin: "rename" },
        }),
      );
    },
  },
} satisfies Plugin;

/** Asks the session's model for a title and names the session with it, unless it is named or a child. */
async function title(api: PluginApi): Promise<void> {
  const info = await api.session.info();

  if (info.name !== null || info.parent !== null) return;
  const view = await api.session.view();
  const model = view.configuration.effective?.model;
  const conversation = transcript(view.messages);

  if (model === undefined || conversation === "") return;

  const outcome = await api.request({
    model,
    system: TITLE_PROMPT,
    messages: [{ role: "user", content: conversation, timestamp: Date.now() }],
    maxOutput: 64,
    signal: api.signal,
  });

  const name = outcome.kind === "ok" ? (outcome.value.split("\n").find((line) => line.trim() !== "")?.trim() ?? "") : "";

  dev("rename", "title", { session: info.id, outcome: outcome.kind, named: name !== "" });

  if (name !== "") await api.session.update({ name: name.slice(0, 100) });
}

/** Returns the user's words and the answers' text, as the title request reads them, at most 4000 characters. */
function transcript(messages: readonly Message[]): string {
  return messages
    .flatMap((message) => {
      if (message.kind === "user") {
        const words =
          typeof message.content === "string"
            ? message.content
            : message.content.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join(" ");

        return [`User: ${words}`];
      }

      return isPart(message, text) ? [`Assistant: ${message.state.markdown}`] : [];
    })
    .join("\n\n")
    .slice(0, 4000);
}
