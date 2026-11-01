import { homedir } from "node:os";

/** Patterns for credentials that show up in logs. Each match becomes [redacted]. */
const PATTERNS: readonly RegExp[] = [
  // Provider keys: OpenAI, Anthropic, OpenRouter and others share the sk- prefix.
  /\bsk-[A-Za-z0-9_-]{16,}/gu,
  // GitHub tokens.
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/gu,
  // Slack tokens.
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/gu,
  // AWS access key ids.
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  // Google API keys.
  /\bAIza[0-9A-Za-z_-]{35}\b/gu,
  // JWTs.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
  // Private key blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
];

/**
 * `Authorization: Bearer x`, `GH_TOKEN=x`, `"apiKey": "x"`: any name ending in
 * key, token, secret or password keeps the name and loses the value.
 */
const ASSIGNMENT =
  /\b([A-Za-z0-9_.-]*(?:authorization|key|token|secret|password|passwd)["']?\s*[:=]\s*["']?)(?:bearer\s+|basic\s+)?[^\s"',;}]{6,}/giu;

/**
 * Removes credentials and the home directory from text before it leaves the
 * machine. Runs when a file enters a triage bundle and again on the issue
 * before it's shown.
 */
export function redact(text: string, home: string = homedir()): string {
  let result = text;

  for (const pattern of PATTERNS) result = result.replace(pattern, "[redacted]");
  result = result.replace(ASSIGNMENT, "$1[redacted]");

  if (home.length > 1) result = result.split(home).join("~");

  return result;
}
