import { isRecord, parseRequest, parseRequestMessages } from "./wire.ts";
import type { JsonRecord } from "./wire.ts";
import type { NativeSystemInjection } from "./transcript.ts";

function withoutCacheControl(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCacheControl);

  if (!isRecord(value)) return value;
  const output: JsonRecord = {};

  for (const [key, child] of Object.entries(value)) {
    if (key !== "cache_control") output[key] = withoutCacheControl(child);
  }

  return output;
}

interface NativeRequestMessage {
  role?: string;
  content?: unknown;
}

function requestMessages(body: Buffer | undefined): NativeRequestMessage[] | undefined {
  if (!body) return undefined;

  try {
    return parseRequest(body).messages;
  } catch {
    return undefined;
  }
}

export function deriveInitialUserPrefix(
  body: Buffer | undefined,
  canonicalContent: unknown[],
): unknown[] | undefined {
  if (canonicalContent.length === 0) return undefined;
  const actual = requestMessages(body)?.[0];

  if (
    actual?.role !== "user" ||
    !Array.isArray(actual.content) ||
    actual.content.length < canonicalContent.length
  ) {
    return undefined;
  }

  const suffix = actual.content.slice(-canonicalContent.length).map(withoutCacheControl);

  if (JSON.stringify(suffix) !== JSON.stringify(canonicalContent.map(withoutCacheControl)))
    return undefined;

  return structuredClone(actual.content.slice(0, -canonicalContent.length));
}

export function deriveInitialSystemMessages(body: Buffer | undefined): unknown[] | undefined {
  const messages = requestMessages(body);

  if (messages?.[0]?.role !== "user") return undefined;
  let end = 1;

  while (messages[end]?.role === "system") end += 1;
  const systems = messages.slice(1, end);

  let trailingStart = messages.length;

  while (trailingStart > end && messages[trailingStart - 1]?.role === "system") trailingStart -= 1;

  if (trailingStart < messages.length) systems.push(...messages.slice(trailingStart));

  return systems.length ? structuredClone(systems) : undefined;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;

  if (!Array.isArray(content)) return "";

  return content
    .map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : ""))
    .join("");
}

function setCacheBreakpoint(message: NativeRequestMessage): void {
  if (typeof message.content === "string") {
    message.content = [
      { type: "text", text: message.content, cache_control: { type: "ephemeral", ttl: "1h" } },
    ];

    return;
  }

  if (!Array.isArray(message.content) || message.content.length === 0) return;
  const last = message.content.at(-1);

  if (!isRecord(last)) return;
  last.cache_control = { type: "ephemeral", ttl: "1h" };
}

function setReplayCacheBreakpoints(messages: NativeRequestMessage[]): void {
  const userIndexes = messages
    .map((message, index) => (message.role === "user" ? index : -1))
    .filter((index) => index >= 0);

  if (userIndexes.length >= 3) {
    for (const message of messages) {
      if (message.role === "system") message.content = withoutCacheControl(message.content);
    }

    const previousIndex = userIndexes.at(-2);
    const previous = previousIndex === undefined ? undefined : messages[previousIndex];

    if (previous) setCacheBreakpoint(previous);
  }

  const final = messages.at(-1);

  if (final) setCacheBreakpoint(final);
}

function removeRepeatedUserReminders(
  messages: NativeRequestMessage[],
  prefix: unknown[] | undefined,
): void {
  const reminder = contentText(prefix).trimEnd();

  if (!reminder || !prefix) return;
  const normalizedPrefix = JSON.stringify(prefix.map(withoutCacheControl));

  for (let index = 1; index < messages.length; index++) {
    const message = messages[index];

    if (message?.role !== "user" || !Array.isArray(message.content)) continue;
    const leading = message.content.slice(0, prefix.length).map(withoutCacheControl);

    if (JSON.stringify(leading) === normalizedPrefix) message.content.splice(0, prefix.length);

    const toolResult = message.content.findLast(
      (block) => isRecord(block) && block.type === "tool_result",
    );

    if (!isRecord(toolResult)) continue;

    const suffix = `\n${reminder}`;

    if (typeof toolResult.content === "string" && toolResult.content.endsWith(suffix)) {
      toolResult.content = toolResult.content.slice(0, -suffix.length);
    } else if (Array.isArray(toolResult.content)) {
      const final = toolResult.content.at(-1);

      if (isRecord(final) && final.type === "text" && typeof final.text === "string") {
        if (final.text === reminder) toolResult.content.pop();
        else if (final.text.endsWith(suffix)) final.text = final.text.slice(0, -suffix.length);
      }
    }
  }
}

function injectNativeSystemMessages(
  messages: NativeRequestMessage[],
  injections: NativeSystemInjection[],
): NativeRequestMessage[] {
  const byAssistant = new Map<number, NativeRequestMessage[]>();
  const trailing: NativeRequestMessage[] = [];

  for (const injection of injections) {
    const message = { role: "system", content: structuredClone(injection.content) };

    if (injection.beforeAssistant === null) trailing.push(message);
    else {
      const pending = byAssistant.get(injection.beforeAssistant) ?? [];
      pending.push(message);
      byAssistant.set(injection.beforeAssistant, pending);
    }
  }

  const output: NativeRequestMessage[] = [];
  let assistantOrdinal = 0;

  for (const message of messages) {
    if (message.role === "assistant") {
      output.push(...(byAssistant.get(assistantOrdinal) ?? []));
      byAssistant.delete(assistantOrdinal);
      assistantOrdinal += 1;
    }

    output.push(message);
  }

  if (byAssistant.size > 0)
    throw new Error("Claude Code request lost an assistant boundary needed by system history");
  output.push(...trailing);

  return output;
}

function normalizeLeadingSystemCache(system: unknown): void {
  if (!Array.isArray(system)) return;

  for (const block of system) {
    if (isRecord(block)) delete block.cache_control;
  }

  const last = system.at(-1);

  if (isRecord(last)) {
    last.cache_control = { type: "ephemeral", ttl: "1h" };
  }
}

export function rewriteInitialRequest(
  body: Buffer,
  prefix: unknown[] | undefined,
  canonicalContent: unknown[],
  initialSystemMessages: unknown[] | undefined,
  nativeSystemInjections?: NativeSystemInjection[],
): Buffer {
  const payload = parseRequest(body);
  let messages = payload.messages;
  const first = messages?.[0];

  if (first?.role !== "user" || !Array.isArray(first.content)) {
    throw new Error("Claude Code request is missing its initial user message");
  }

  if (prefix) first.content = [...structuredClone(prefix), ...structuredClone(canonicalContent)];

  if (initialSystemMessages?.length && messages) {
    let systemEnd = 1;

    while (messages[systemEnd]?.role === "system") systemEnd += 1;
    messages.splice(
      1,
      systemEnd - 1,
      ...parseRequestMessages(structuredClone(initialSystemMessages)),
    );

    const initialText = initialSystemMessages
      .map((message) => (isRecord(message) ? contentText(message.content) : ""))
      .join("\n");

    while (messages.at(-1)?.role === "system") {
      const trailingText = contentText(messages.at(-1)?.content);

      if (!trailingText || !initialText.includes(trailingText)) break;
      messages.pop();
    }

    removeRepeatedUserReminders(messages, prefix);
  }

  if (nativeSystemInjections) {
    messages = injectNativeSystemMessages(messages, nativeSystemInjections);
    payload.messages = messages;
    normalizeLeadingSystemCache(payload.system);
  }

  if (initialSystemMessages?.length || nativeSystemInjections) setReplayCacheBreakpoints(messages);

  return Buffer.from(JSON.stringify(payload));
}
