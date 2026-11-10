import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recentEntries, renderDoctor, type DoctorReport } from "../src/doctor-command.ts";
import { holdsSecrets, readShareable, secretFilesIn } from "../src/secrets.ts";

const FILES: readonly (readonly [string, boolean])[] = [
  ["auth.json", true],
  ["mcp-auth.json", true],
  ["identity.key", true],
  ["connect.json", true],
  ["host.json", true],
  ["secret.key", true],
  ["secret.sealed", true],
  ["anything.key", true],
  ["tui.log", false],
  ["init-20260601-120000.log", false],
  ["doctor.json", false],
  ["settings.json", false],
  ["nyte.db", false],
  ["logs", false],
];

test.each(FILES)("%s holds secrets: %p", async (name, secret) => {
  expect(holdsSecrets(name)).toBe(secret);
  expect(holdsSecrets(`/home/ada/.nyte/${name}`)).toBe(secret);
  expect(secretFilesIn([name])).toEqual(secret ? [name] : []);

  const refused = await readShareable(`/nonexistent/${name}`).then(
    () => "read",
    (error: unknown) => String(error),
  );

  expect(/holds secrets/u.test(refused)).toBe(secret);
});

describe("doctor", () => {
  test("counts crashes from the last 7 days only", async () => {
    const home = await mkdtemp(join(tmpdir(), "nyte-doctor-"));

    try {
      const now = Date.parse("2026-06-10T12:00:00.000Z");
      await Bun.write(
        join(home, "logs", "tui.log"),
        [
          "2026-06-09T08:00:00.000Z [render] boom",
          "Error: boom\n    at x",
          "",
          "2026-05-01T08:00:00.000Z [process] old",
          "",
        ].join("\n"),
      );
      expect(await recentEntries([join(home, "logs", "tui.log")], now)).toBe(1);
      await writeFile(join(home, "logs", "tui.log"), "");
      expect(await recentEntries([join(home, "logs", "tui.log")], now)).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("counts host faults from the last 7 days across the log and its rotated file", async () => {
    const home = await mkdtemp(join(tmpdir(), "nyte-doctor-"));

    try {
      const now = Date.parse("2026-06-10T12:00:00.000Z");
      const log = join(home, "logs", "host-faults.log");
      await Bun.write(
        log,
        [
          '2026-06-10T11:00:00.000Z [lease] lost {"what":"main","reason":"lapsed"}',
          '2026-06-09T08:00:00.000Z [presence] beat failed {"error":"SQLITE_BUSY"}',
          "",
        ].join("\n"),
      );
      await Bun.write(
        `${log}.1`,
        [
          '2026-05-01T08:00:00.000Z [host] stopped {"error":"Error: old"}',
          '2026-06-08T08:00:00.000Z [host] stopped {"error":"Error: boom"}',
          "",
        ].join("\n"),
      );
      expect(await recentEntries([log, `${log}.1`], now)).toBe(3);
      expect(await recentEntries([join(home, "logs", "missing.log")], now)).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("every problem prints the command that fixes it", () => {
    const report: DoctorReport = {
      version: "0.0.22",
      target: "linux-x64",
      checks: [
        { id: "binary", status: "ok", detail: "~/.nyte/bin/0.0.22/nyte" },
        {
          id: "secrets",
          status: "fail",
          detail: "auth.json is 0644 (not opened)",
          fix: "chmod 600 ~/.nyte/auth.json",
        },
        { id: "update", status: "warn", detail: "0.0.24 is available", fix: "nyte update" },
      ],
      summary: { ok: 1, warn: 1, fail: 1, skip: 0 },
    };

    expect(renderDoctor(report, { rich: true, color: false })).toEqual([
      "  Version         0.0.22, linux-x64",
      "  Binary          ~/.nyte/bin/0.0.22/nyte",
      "✗ Secrets         auth.json is 0644 (not opened)",
      "                  Run: chmod 600 ~/.nyte/auth.json",
      "! Update          0.0.24 is available",
      "                  Run: nyte update",
      "",
      "1 problem, 1 warning.",
    ]);
  });
});
