// Build the desktop first, then run with NYTE_DESKTOP_E2E=1.
// Vitest loads the workspace dependencies; Playwright drives the real Electron window.
import { SqliteStore } from "@nyte-ai/core/store";
import type { SessionInfo } from "@nyte-ai/core";
import { sessionId } from "@nyte-ai/protocol";
import type { CommitBody } from "@nyte-ai/protocol";
import { expect } from "@playwright/test";
import { test } from "vitest";
import { launchDesktop, openBenchmarkSession } from "./desktop.ts";

test.runIf(process.env["NYTE_DESKTOP_E2E"] === "1")(
  "thread navigation and work summaries distinguish read state, tool errors, and active work",
  async () => {
    const desktop = await launchDesktop({
      sessionCount: 2,
      turnsPerSession: 1,
      catalogModelCount: 5,
    });
    const seeded = desktop.fixture.sessions[0];
    if (seeded === undefined) throw new Error("Expected a session fixture");
    const store = new SqliteStore(desktop.fixture.paths.workspaceStore);
    const session = await store.open(seeded.id);
    const row = desktop.page
      .getByRole("navigation", { name: "Sessions and workspaces" })
      .getByRole("button", { name: seeded.name });
    const unread = row.getByRole("img", { name: "Completed, unread" });

    async function writeRun(
      phase: NonNullable<SessionInfo["heads"][number]["run"]>["phase"],
      startedAt: number,
    ): Promise<void> {
      const from = await session.refs.read("refs/runs/main");
      const [to] = await session.objects.put([
        {
          kind: "run",
          id: `status-${startedAt}`,
          head: "main",
          origin: { kind: "user" },
          root: `status-${startedAt}`,
          phase,
          startedAt,
          attempts: 1,
          config: {},
        },
      ]);
      if (to === undefined) throw new Error("Expected a run object");
      const outcome = await session.refs.update([{ name: "refs/runs/main", from, to }], {
        reason: "status-test",
      });
      if (!outcome.ok) throw new Error("Could not update the fixture run");
    }

    async function appendEditedTurn(path: string, completed = true): Promise<void> {
      const timestamp = Date.now();
      const usage = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      };
      const assistant = {
        role: "assistant",
        provider: "opencode",
        api: "openai-responses",
        model: desktop.fixture.catalog.firstModelId,
        usage,
        timestamp,
      } as const;
      const editId = `edit:${path}`;
      const commandId = `test:${path}`;
      const bodies: CommitBody[] = [
        { kind: "message", message: { role: "user", content: `Update ${path}`, timestamp } },
        {
          kind: "message",
          message: {
            ...assistant,
            stopReason: "toolUse",
            content: [
              { type: "toolCall", id: editId, name: "edit", arguments: { path } },
              {
                type: "toolCall",
                id: commandId,
                name: "bash",
                arguments: { command: "pnpm test" },
              },
            ],
          },
        },
        {
          kind: "message",
          message: {
            role: "toolResult",
            toolCallId: editId,
            toolName: "edit",
            timestamp,
            content: [{ type: "text", text: "Saved" }],
            isError: false,
            details: { patch: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n` },
          },
        },
        {
          kind: "message",
          message: {
            role: "toolResult",
            toolCallId: commandId,
            toolName: "bash",
            timestamp,
            content: [{ type: "text", text: "One test failed" }],
            isError: true,
          },
        },
        {
          kind: "message",
          message: {
            ...assistant,
            stopReason: "stop",
            content: [{ type: "text", text: `Saved ${path}; the test needs attention.` }],
          },
        },
      ];
      const from = await session.refs.read("refs/heads/main");
      let tip = from;
      // An interrupted command has neither a result nor a final assistant response.
      for (const body of completed ? bodies : bodies.slice(0, -2)) {
        const [oid] = await session.objects.put([
          { kind: "commit", parent: tip, body, at: timestamp },
        ]);
        if (oid === undefined) throw new Error("Expected a transcript commit");
        tip = oid;
      }
      const moved = await session.refs.update([{ name: "refs/heads/main", from, to: tip }], {
        reason: "status-test",
      });
      if (!moved.ok) throw new Error("Could not append the fixture turn");
    }

    const ownership = await session.leases.acquire("refs/heads/main", 120_000);
    try {
      if (!ownership.ok) throw new Error("Could not hold the fixture run's execution lease");
      await openBenchmarkSession(desktop, 1);
      await writeRun({ kind: "done" }, 100);
      await expect(unread).toBeVisible({ timeout: 15_000 });
      await row.hover();
      // Preloading is not reading. Even after the snapshot is available, the dot stays.
      await desktop.page.evaluate(async (id) => {
        await window.nyte.sessions.snapshot({ sessionId: id });
      }, sessionId(seeded.id));
      await expect(unread).toBeVisible({ timeout: 15_000 });
      await openBenchmarkSession(desktop, 0);
      await expect(unread).toHaveCount(0, { timeout: 15_000 });
      await openBenchmarkSession(desktop, 1);
      await expect(unread).toHaveCount(0, { timeout: 15_000 });
      await desktop.page.reload();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(unread).toHaveCount(0, { timeout: 15_000 });
      const latestName = await desktop.page.evaluate(async () => {
        localStorage.setItem("nyte:startup-destination:v1", "last-session");
        const sessions = await window.nyte.sessions.list({ parent: null, limit: 1 });
        return sessions.items[0]?.name;
      });
      if (latestName === undefined) throw new Error("Expected a latest session");
      await desktop.page.reload();
      await expect(
        desktop.page
          .getByRole("region", { name: "Active chat pane" })
          .getByText(`Benchmark prompt 0001 for ${latestName}`, { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      await openBenchmarkSession(desktop, 0);
      await writeRun({ kind: "tools" }, 200);
      await expect(row.getByRole("img", { name: "Running" })).toBeVisible({ timeout: 15_000 });
      await row.click();
      await expect(row.getByRole("img", { name: "Running" })).toBeVisible({ timeout: 15_000 });
      await writeRun({ kind: "done" }, 200);
      await expect(row.getByRole("img", { name: "Running" })).toHaveCount(0, { timeout: 15_000 });
      await expect(unread).toHaveCount(0, { timeout: 15_000 });
      await openBenchmarkSession(desktop, 1);
      await expect(unread).toHaveCount(0, { timeout: 15_000 });

      await writeRun({ kind: "done" }, 300);
      await expect(unread).toBeVisible({ timeout: 15_000 });
      await openBenchmarkSession(desktop, 0);
      await expect(unread).toHaveCount(0, { timeout: 15_000 });
      await writeRun(
        { kind: "failed", failure: { class: "provider", message: "Fixture provider failure" } },
        400,
      );
      await expect(row.getByRole("img", { name: "Failed" })).toBeVisible({ timeout: 15_000 });
      await row.click();
      await expect(row.getByRole("img", { name: "Failed" })).toBeVisible({ timeout: 15_000 });

      const pane = desktop.page.getByRole("region", { name: "Active chat pane" });
      const reviewCards = pane.getByRole("region", { name: /^\d+ Files? Changed$/ });
      await appendEditedTurn("src/first.ts");
      await writeRun({ kind: "done" }, 500);
      await expect(pane.getByText("Update src/first.ts", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(reviewCards).toHaveCount(1);
      await expect(pane.getByTitle("Open src/first.ts in Changes")).toBeVisible();

      await writeRun({ kind: "tools" }, 600);
      await appendEditedTurn("src/second.ts");
      await expect(pane.getByText("Update src/second.ts", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(reviewCards).toHaveCount(0);
      await writeRun({ kind: "done" }, 600);
      await expect(reviewCards).toHaveCount(1, { timeout: 15_000 });
      await expect(pane.getByTitle("Open src/second.ts in Changes")).toBeVisible();
      await expect(pane.getByTitle("Open src/first.ts in Changes")).toHaveCount(0);
      await expect(pane.getByText("Work failed", { exact: true })).toHaveCount(0);
      await pane
        .getByRole("button", { name: /^Worked/ })
        .last()
        .click();
      await expect(pane.getByText("Command failed", { exact: true }).last()).toBeVisible();

      await writeRun({ kind: "tools" }, 700);
      await appendEditedTurn("src/interrupted.ts", false);
      await expect(pane.getByText("Update src/interrupted.ts", { exact: true }).last()).toBeVisible(
        {
          timeout: 15_000,
        },
      );
      await writeRun({ kind: "aborted" }, 700);
      await expect(row.getByRole("img", { name: "Running" })).toHaveCount(0, { timeout: 15_000 });
      await openBenchmarkSession(desktop, 1);
      await row.click();
      await expect(pane.getByText("Update src/interrupted.ts", { exact: true }).last()).toBeVisible(
        {
          timeout: 15_000,
        },
      );
      await expect(pane.locator('[aria-busy="true"]')).toHaveCount(0);
      await pane
        .getByRole("button", { name: /^Worked/ })
        .last()
        .click();
      await expect(pane.getByText("Command stopped", { exact: true }).last()).toBeVisible();
      expect(desktop.pageErrors).toEqual([]);
    } finally {
      if (ownership.ok) await session.leases.release(ownership.lease);
      await session.close();
      await store.close();
      await desktop.close();
    }
  },
  120_000,
);
