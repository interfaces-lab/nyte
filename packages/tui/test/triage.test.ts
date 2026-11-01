import { describe, expect, test } from "bun:test";
import { redact } from "../src/redact.ts";
import { claudeSettings, parseIssue, parseTriageArgs } from "../src/triage-command.ts";
import { TRIAGE_PLAYBOOK } from "../src/triage-playbook.ts";

describe("redact", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123", "key [redacted]"],
    ["token ghp_abcdefghijklmnopqrstuvwxyz0123456789", "token [redacted]"],
    ["pat github_pat_11ABCDEFG0123456789_abcdefghijklmnop", "pat [redacted]"],
    ["slack xoxb-1234567890-abcdefghij", "slack [redacted]"],
    ["aws AKIAABCDEFGHIJKLMNOP", "aws [redacted]"],
    ["Authorization: Bearer abc.def.ghi-123456", "Authorization: [redacted]"],
    ['{"apiKey": "abcdef123456"}', '{"apiKey": "[redacted]"}'],
    ["CENTRAL_LICENSE_KEY=00000000-1111-2222", "CENTRAL_LICENSE_KEY=[redacted]"],
    ["export GH_TOKEN=abcdef123456", "export GH_TOKEN=[redacted]"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlMTIz", "jwt [redacted]"],
  ];

  for (const [input, output] of cases) {
    test(input.slice(0, 24), () => {
      expect(redact(input, "/home/ada")).toBe(output);
    });
  }

  test("the home directory becomes ~", () => {
    expect(redact("at /home/ada/.nyte/logs/tui.log", "/home/ada")).toBe("at ~/.nyte/logs/tui.log");
  });

  test("ordinary log lines pass through", () => {
    const line = "2026-06-01T12:00:00.000Z [process] store migration 41 failed: SQLITE_BUSY";
    expect(redact(line, "/home/ada")).toBe(line);
  });
});

describe("triage", () => {
  test("parses the agent and the description", () => {
    expect(parseTriageArgs(["--agent", "claude", "blank", "window"])).toEqual({
      agent: "claude",
      problem: "blank window",
    });
    expect(parseTriageArgs(["--agent=codex"])).toEqual({ agent: "codex", problem: "" });
    expect(() => parseTriageArgs(["--agent", "gpt"])).toThrow(/nyte, claude or codex/u);
    expect(() => parseTriageArgs(["--post"])).toThrow(/Unknown option/u);
  });

  test("the issue title is the first line and always starts with [Bug]:", () => {
    expect(parseIssue("\n# Blank window after update\n\n### Area\nDesktop app\n")).toEqual({
      title: "[Bug]: Blank window after update",
      body: "### Area\nDesktop app",
    });
    expect(parseIssue("[Bug]: Crash\nbody").title).toBe("[Bug]: Crash");
  });

  test("Claude Code is denied the secret files and gh issue", () => {
    const deny: string[] = JSON.parse(claudeSettings("/home/ada")).permissions.deny;

    for (const name of [
      "auth.json",
      "mcp-auth.json",
      "identity.key",
      "connect.json",
      "host.json",
      "*.key",
    ]) {
      expect(deny.some((rule) => rule.startsWith("Read(") && rule.endsWith(`/${name})`))).toBe(
        true,
      );
    }

    expect(deny).toContain("Bash(gh issue:*)");
  });

  test("the playbook forbids reading secrets and posting, and follows the bug template", () => {
    for (const phrase of [
      "auth.json",
      "identity.key",
      "connect.json",
      "*.key",
      "gh issue create",
      "[Bug]: ",
      "### ",
    ]) {
      expect(TRIAGE_PLAYBOOK).toContain(phrase);
    }
  });
});
