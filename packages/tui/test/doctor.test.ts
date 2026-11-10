import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recentEntries, renderDoctor, type DoctorReport } from "../src/doctor-command.ts";
import { holdsSecrets, readShareable, secretFilesIn } from "../src/secrets.ts";

const SECRETS = [
  "auth.json",
  "mcp-auth.json",
  "identity.key",
  "connect.json",
  "host.json",
  "secret.key",
  "secret.sealed",
  "anything.key",
];

describe("secret files", () => {
  test("every secret file is refused by name, wherever it is", async () => {
    for (const name of SECRETS) {
      expect(holdsSecrets(name)).toBe(true);
      expect(holdsSecrets(`/home/ada/.nyte/${name}`)).toBe(true);

      const refused = await readShareable(`/nonexistent/${name}`).then(
        () => "read",
        (error: unknown) => String(error),
      );

      expect(refused).toMatch(/holds secrets/u);
    }
  });

  test("logs and reports are readable", () => {
    for (const name of ["tui.log", "init-20260601-120000.log", "doctor.json", "settings.json"]) {
      expect(holdsSecrets(name)).toBe(false);
    }
  });

  test("secretFilesIn picks secrets out of a directory listing", () => {
    expect(secretFilesIn(["nyte.db", "auth.json", "logs", "identity.key"])).toEqual([
      "auth.json",
      "identity.key",
    ]);
  });
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
