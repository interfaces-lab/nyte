import { homedir } from "node:os";

const PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/gu,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/gu,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  /\bAIza[0-9A-Za-z_-]{35}\b/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
];

const ASSIGNMENT =
  /\b([A-Za-z0-9_.-]*(?:authorization|key|token|secret|password|passwd)["']?\s*[:=]\s*["']?)(?:bearer\s+|basic\s+)?[^\s"',;}]{6,}/giu;

export function redact(text: string, home: string = homedir()): string {
  let result = text;

  for (const pattern of PATTERNS) result = result.replace(pattern, "[redacted]");
  result = result.replace(ASSIGNMENT, "$1[redacted]");

  if (home.length > 1) result = result.split(home).join("~");

  return result;
}
