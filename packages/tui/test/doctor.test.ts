import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recentCrashes, renderDoctor, type DoctorReport } from "../src/doctor-command.ts";
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
      expect(await recentCrashes(home, now)).toBe(1);
      await writeFile(join(home, "logs", "tui.log"), "");
      expect(await recentCrashes(home, now)).toBe(0);
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
      summary: { ok: 1, warn: 1, fail: 1 },
    };

    expect(renderDoctor(report, false).split("\n").slice(0, 8)).toEqual([
      "nyte doctor  0.0.22 · linux-x64",
      "",
      "  ✓ binary   ~/.nyte/bin/0.0.22/nyte",
      "  ✗ secrets  auth.json is 0644 (not opened)",
      "             run: chmod 600 ~/.nyte/auth.json",
      "  ● update   0.0.24 is available",
      "             run: nyte update",
      "",
    ]);
  });
});
