/**
 * Tolerant JSON parsing for tool-call arguments: repairs malformed string literals, and parses partial JSON during streaming so clients can render arguments before the call is complete.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/json-parse.ts
 * Synced with pi 7ebf9087e.
 */
import { parse as partialParse } from "partial-json";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const ToolArgumentsSchema = Type.Record(Type.String(), Type.Unknown());

const VALID_JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

function isControlCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0);

  return codePoint !== undefined && codePoint >= 0x00 && codePoint <= 0x1f;
}

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

    repaired += isControlCharacter(char) ? escapeControlCharacter(char) : char;
  }

  return repaired;
}

/**
 * Attempts to parse potentially incomplete JSON during streaming.
 * Always returns a valid object, even if the JSON is incomplete.
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
        // Partial parsing can silently drop fields containing raw control characters.
        value = partialParse(repaired);
      } catch {
        return {};
      }
    }
  }

  return Value.Check(ToolArgumentsSchema, value) ? value : {};
}
