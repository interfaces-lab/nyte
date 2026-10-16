/**
 * JSON parsing for tool-call arguments: repairs malformed string literals, parses partial JSON during streaming so clients can render arguments before the call is complete, and parses a finished call strictly so a truncated call is reported instead of run.
 */
import type { ToolCall } from "@nyte-ai/schema/model";
import { parse as partialParse } from "partial-json";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const ToolArgumentsSchema = Type.Record(Type.String(), Type.Unknown());

const VALID_JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

function escapeControlCharacter(char: string): string {
  switch (char) {
    case "\b":
      return "\\b";
    case "\f":
      return "\\f";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    default:
      return `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`;
  }
}

/**
 * Repairs malformed JSON string literals by:
 * - escaping raw control characters inside strings
 * - doubling backslashes before invalid escape characters
 */
export function repairJson(json: string): string {
  let repaired = "";
  let inString = false;

  for (let index = 0; index < json.length; index++) {
    const char = json[index];

    if (!inString) {
      repaired += char;

      if (char === '"') {
        inString = true;
      }

      continue;
    }

    if (char === '"') {
      repaired += char;
      inString = false;
      continue;
    }

    if (char === "\\") {
      const nextChar = json[index + 1];

      if (nextChar === undefined) {
        repaired += "\\\\";
        continue;
      }

      if (nextChar === "u") {
        const unicodeDigits = json.slice(index + 2, index + 6);

        if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
          repaired += `\\u${unicodeDigits}`;
          index += 5;
          continue;
        }
      }

      if (VALID_JSON_ESCAPES.has(nextChar)) {
        repaired += `\\${nextChar}`;
        index += 1;
        continue;
      }

      repaired += "\\\\";
      continue;
    }

    const codePoint = char.codePointAt(0) ?? 0x20;
    repaired += codePoint <= 0x1f ? escapeControlCharacter(char) : char;
  }

  return repaired;
}

/**
 * Attempts to parse potentially incomplete JSON during streaming.
 * Always returns a valid object, even if the JSON is incomplete. Partial parsing runs on the
 * repaired text, because it can silently drop fields containing raw control characters.
 *
 * @param partialJson The partial JSON string from streaming
 * @returns Parsed object or empty object if parsing fails
 */
export function parseStreamingJson(
  partialJson: string | undefined,
): Static<typeof ToolArgumentsSchema> {
  if (!partialJson || partialJson.trim() === "") return {};

  let value: unknown;

  try {
    value = JSON.parse(partialJson);
  } catch {
    const repaired = repairJson(partialJson);

    try {
      value = JSON.parse(repaired);
    } catch {
      try {
        value = partialParse(repaired);
      } catch {
        return {};
      }
    }
  }

  return Value.Check(ToolArgumentsSchema, value) ? value : {};
}

/**
 * Parses the complete arguments text of a finished tool call.
 *
 * Unlike {@link parseStreamingJson}, this never keeps a partially parsed prefix: once the call is
 * finished, text that is not a JSON object means the model sent malformed or truncated arguments.
 * `arguments` is then `{}` and `argumentsError` describes the problem with the text the model sent,
 * so the call fails validation instead of running with half its arguments.
 */
export function parseToolCallArguments(
  json: string | undefined,
): Pick<ToolCall, "arguments" | "argumentsError"> {
  if (!json || json.trim() === "") return { arguments: {} };

  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch (error) {
    try {
      value = JSON.parse(repairJson(json));
    } catch {
      return unparsedToolCallArguments(error instanceof Error ? error.message : String(error), json);
    }
  }

  return Value.Check(ToolArgumentsSchema, value)
    ? { arguments: value }
    : unparsedToolCallArguments("Tool arguments must be a JSON object", json);
}

/** The arguments of a tool call whose response ended before the call finished. */
export function unfinishedToolCallArguments(
  json: string,
): Pick<ToolCall, "arguments" | "argumentsError"> {
  return unparsedToolCallArguments("The response ended before this tool call finished", json);
}

function unparsedToolCallArguments(
  reason: string,
  json: string,
): Pick<ToolCall, "arguments" | "argumentsError"> {
  return { arguments: {}, argumentsError: `${reason}\n\nReceived arguments:\n${json}` };
}
