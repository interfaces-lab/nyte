import { homedir } from "node:os";
import { expect, it } from "vitest";
import type { createOtelExport } from "@nyte-ai/host/otel";
import type { GitHubCommandResult } from "@nyte-ai/host";
import { DesktopHost } from "./host.ts";
import { unusedBrowserAgent } from "./browser-stub.ts";

const authenticated = JSON.stringify([{ active: true, state: "success" }]);
const account = { login: "octocat", name: null, avatar_url: null };
const completed = (stdout = "", code = 0, stderr = ""): GitHubCommandResult => ({
  kind: "completed",
  code,
  stdout,
  stderr,
});

it("serves GitHub from Home and never sends command output or exceptions to telemetry", async () => {
  const recorded: unknown[] = [];
  const operations: Parameters<ReturnType<typeof createOtelExport>["telemetry"]["startSpan"]>[0][] =
    [];
  const telemetry: ReturnType<typeof createOtelExport>["telemetry"] = {
    async startSpan(options, fn) {
      recorded.push(options);
      operations.push(options);
      return fn({
        ...telemetry,
        setAttributes: (attributes) => {
          recorded.push(attributes);
        },
        setStatus: (status) => {
          recorded.push(status);
        },
        addEvent: () => {},
      });
    },
  };
  const events: unknown[] = [];
  let phase: "failing" | "throwing" | "healthy" = "failing";
  const host = new DesktopHost({
    storeWorker: new URL("../../../core/src/kernel/store-worker.ts", import.meta.url),
    createOtelExport: () => ({ telemetry, shutdown: async () => {} }),
    createModels: () => {
      throw new Error("Must not compose storage");
    },
    emitHostEvent: (event) => {
      events.push(event);
    },
    emitWatchEvent: () => {},
    openExternal: () => {},
    revealPath: () => undefined,
    showContextMenu: () => Promise.resolve(undefined),
    confirmExternal: () => Promise.resolve("cancel"),
    listFonts: async () => ({ sans: [], monospace: [] }),
    pickFolder: async () => undefined,
    browser: {
      open: () => {
        throw new Error("Unused");
      },
      navigate: () => {},
      close: () => {},
      captureFrame: () => Promise.resolve(undefined),
      setBounds: () => {},
      retain: () => {},
      release: () => {},
      warm: async () => {},
      releaseWindow: () => undefined,
      menu: async () => undefined,
      perform: async () => {},
      agent: unusedBrowserAgent(),
    },
    runGitHubCommand: async (request) => {
      expect(request.cwd).toBe(homedir());
      if (phase === "failing") return completed("SECRET stdout", 1, "SECRET stderr");
      if (request.args[0] === "api") {
        if (phase === "throwing") throw new Error("SECRET /private/path https://secret.test");
        return completed(JSON.stringify(account));
      }
      return completed(authenticated);
    },
  });
  try {
    expect(await host.call(1, "host.github.state", undefined)).toMatchObject({ kind: "error" });
    expect(recorded).toContainEqual({
      name: "desktop.github.command",
      attributes: { operation: "gh.auth.status" },
    });
    expect(recorded).toContainEqual({
      outcome: "completed",
      code: 1,
      duration_ms: expect.any(Number),
    });
    phase = "throwing";
    expect(await host.call(2, "host.github.state", undefined)).toMatchObject({ kind: "error" });
    expect(recorded).toContainEqual({
      outcome: "failed",
      code: undefined,
      duration_ms: expect.any(Number),
    });
    phase = "healthy";
    // A signed-in account is answered as it stands; no `gh auth login` starts.
    expect(await host.call(1, "host.github.signIn", undefined)).toMatchObject({ kind: "ready" });
    expect(events).toContainEqual({ kind: "github_changed" });
    expect(await host.call(2, "host.github.signOut", undefined)).toMatchObject({ kind: "ready" });
    for (const entry of operations) {
      expect(entry).toMatchObject({
        name: "desktop.github.command",
        attributes: {
          operation: expect.stringMatching(/^gh\.(?:api|auth\.(?:status|logout))$/u),
        },
      });
    }
    expect(operations).toContainEqual({
      name: "desktop.github.command",
      attributes: { operation: "gh.api" },
    });
    expect(operations).toContainEqual({
      name: "desktop.github.command",
      attributes: { operation: "gh.auth.logout" },
    });
    expect(JSON.stringify(recorded)).not.toMatch(
      /SECRET|private|secret\.test|--hostname|octocat|github\.com\b/u,
    );
  } finally {
    await host.close();
  }
});
