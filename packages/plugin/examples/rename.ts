/**
 * The `rename` plugin: `/rename <name>` names the chat, `/rename` alone asks a
 * model for a name from the conversation so far, and a root chat with no name
 * is named in the background on its first prompt. The prompt, the request
 * shape, and the trigger are opencode v2's; `gpt-5.6-luna` at medium effort is
 * asked first, then the chat's own model when that fails.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/core/src/plugin/agent.ts (PROMPT_TITLE),
 * https://github.com/anomalyco/opencode/blob/v2/packages/core/src/session/title.ts, and
 * https://github.com/anomalyco/opencode/blob/v2/packages/core/src/session/runner/llm.ts (first-prompt trigger)
 */
import { contentText, uuidv7 } from "@nyte-ai/ai";
import type { Api, Model, Models, SimpleStreamOptions } from "@nyte-ai/ai";
import { definePlugin } from "@nyte-ai/plugin";
import type { Message } from "@nyte-ai/schema";

export const TITLE_PROMPT = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- <=50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  -> create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" -> Debugging production 500 errors
"refactor user service" -> Refactoring user service
"why is app.js failing" -> app.js failure investigation
"implement rate limiting" -> Rate limiting implementation
"how do I connect postgres to my API" -> Postgres API connection
"best practices for React hooks" -> React hooks best practices
"@src/credential.ts can you add refresh token support" -> Credential refresh token support
"@utils/parser.ts this is broken" -> Parser bug fix
"look at @config.json" -> Config review
"@App.tsx add dark mode toggle" -> Dark mode toggle in App
</examples>`;

/** The model asked first, at the effort it is asked at. */
export const TITLE_MODEL_ID = "gpt-5.6-luna";
const TITLE_THINKING = "medium";
const MAX_TITLE_CHARS = 100;
const MAX_REQUEST_CHARS = 2000;
const MAX_CONVERSATION_CHARS = 8000;
const MAX_OUTPUT_TOKENS = 64;

export type TitleModels = Pick<Models, "getModels" | "streamSimple">;

function spoken(message: Message): string | undefined {
  if (message.role === "toolResult") return undefined;
  const text = contentText(message.content, "").trim();
  return text === "" ? undefined : text;
}

/**
 * What the title describes: the first user message alone while that is all
 * there is, else that request plus the exchange since, so a regenerated
 * title follows where the conversation went.
 */
export function titleRequest(messages: readonly Message[]): string | undefined {
  const index = messages.findIndex((message) => message.role === "user");
  const first = messages[index];
  const request = first === undefined ? undefined : spoken(first);
  if (request === undefined) return undefined;
  const recent = messages.slice(index + 1).flatMap((message) => {
    const text = spoken(message);
    return text === undefined ? [] : [`${message.role === "user" ? "User" : "Assistant"}: ${text}`];
  });
  if (recent.length === 0) return request;
  const conversation = `Original request:\n${request.slice(0, MAX_REQUEST_CHARS)}\n\nRecent conversation:\n${recent.join("\n\n")}`;
  return conversation.slice(0, MAX_CONVERSATION_CHARS);
}

/** Luna wherever a signed-in provider serves it, then the chat's own model. */
export function titleCandidates(models: TitleModels, primary: Model<Api>): Model<Api>[] {
  const luna = models.getModels().filter((model) => model.id === TITLE_MODEL_ID);
  return [...luna, primary].filter(
    (model, index, all) =>
      all.findIndex((other) => other.provider === model.provider && other.id === model.id) ===
      index,
  );
}

function titleOptions(model: Model<Api>, signal: AbortSignal | undefined): SimpleStreamOptions {
  const options: SimpleStreamOptions = {
    signal,
    maxTokens: MAX_OUTPUT_TOKENS,
    cacheRetention: "none",
    sessionId: uuidv7(),
  };
  return model.reasoning ? { ...options, reasoning: TITLE_THINKING } : options;
}

/** The first line the first answering candidate gives, or nothing when every candidate fails. */
export async function generateTitle(
  models: TitleModels,
  primary: Model<Api>,
  messages: readonly Message[],
  signal?: AbortSignal,
): Promise<string | undefined> {
  const request = titleRequest(messages);
  if (request === undefined) return undefined;
  const context = {
    systemPrompt: TITLE_PROMPT,
    messages: [
      { role: "user", content: [{ type: "text", text: request }], timestamp: Date.now() },
    ] satisfies Message[],
  };
  for (const model of titleCandidates(models, primary)) {
    let line: string | undefined;
    try {
      const response = await models
        .streamSimple(model, context, titleOptions(model, signal))
        .result();
      if (response.stopReason === "error" || response.stopReason === "aborted") continue;
      line = contentText(response.content)
        .split("\n")
        .map((candidate) => candidate.trim())
        .find((candidate) => candidate !== "");
    } catch {
      continue;
    }
    if (line !== undefined) return line.slice(0, MAX_TITLE_CHARS);
  }
  return undefined;
}

export function renamePlugin(deps: { readonly models: TitleModels; readonly model: Model<Api> }) {
  return definePlugin({
    id: "rename",
    session(api) {
      /** Generate, and keep the result only if nobody named the chat meanwhile: a typed name wins. */
      const generate = async (messages: readonly Message[]): Promise<void> => {
        const before = (await api.session.info()).name;
        const title = await generateTitle(deps.models, deps.model, messages);
        if (title === undefined) return;
        if ((await api.session.info()).name !== before) return;
        await api.session.rename(title);
      };
      api.commands.add((draft) => {
        draft.set("rename", {
          description: "Name the chat; with no name, the model picks one",
          run: async (argument) => {
            const name = argument.trim();
            if (name !== "") {
              await api.session.rename(name);
              return `Chat named ${name}`;
            }
            await generate((await api.session.context()).messages);
            return undefined;
          },
        });
      });
      // The first response of a root chat that has no name titles it in the
      // background, the way opencode's runner forks a title on the first prompt.
      api.hook("transform_context", (event) => {
        const { messages } = event;
        if (messages.filter((message) => message.role === "user").length !== 1) return undefined;
        void api.session
          .info()
          .then((info) => (info.name === undefined && !info.child ? generate(messages) : undefined))
          .catch((cause: unknown) => {
            api.diagnostics.warn(
              `title: ${cause instanceof Error ? cause.message : String(cause)}`,
            );
          });
        return undefined;
      });
    },
  });
}
