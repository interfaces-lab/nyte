import { afterAll, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionId } from "@nyte-ai/protocol";
import type { JobInfo } from "@nyte-ai/protocol";
import { BackgroundWork } from "./jobs-panel.tsx";

vi.hoisted(() => vi.stubGlobal("window", { nyte: {} }));
afterAll(() => vi.unstubAllGlobals());

const id = sessionId("chat");
const command: JobInfo = {
  id: "command",
  origin: { kind: "run", runId: "run", callId: "call" },
  head: "main",
  command: "Run tests",
  phase: { kind: "running", mode: "background" },
  startedAt: 1,
  updatedAt: 1,
  output: "<script>output</script>",
};

function render(jobs?: readonly JobInfo[], open = false) {
  const client = new QueryClient();
  if (jobs !== undefined) client.setQueryData(["jobs", id], jobs);
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <BackgroundWork
          sessionId={id}
          open={open}
          onOpenChange={() => {}}
          onOpenTerminal={() => {}}
          viewport={null}
        />
      </QueryClientProvider>,
    );
  } finally {
    client.clear();
  }
}

describe("composer background work", () => {
  test("adds nothing to the composer until a terminal runs", () => {
    expect(render()).toBe("");
    expect(render([])).toBe("");
  });

  test("shows the terminal chip only while a terminal is running", () => {
    const html = render([command, { ...command, id: "second" }]);
    expect(html).toContain('aria-label="Open terminals (2)"');
    expect(html).toContain(">Terminals</span>");
    expect(html).toContain(">2</span>");
    expect(render([command])).toContain(">Terminal</span>");
    expect(render([{ ...command, phase: { kind: "completed" } }])).toBe("");
    expect(render([{ ...command, phase: { kind: "completed" } }], true)).toBe("");
  });

  test("the tray lists live shells only, each with its own stop action", () => {
    const html = render(
      [command, { ...command, id: "done", phase: { kind: "completed" }, command: "Finished" }],
      true,
    );
    expect(html).toContain("1 terminal");
    expect(html).toContain('aria-label="Open terminal for Run tests"');
    expect(html).toContain('aria-label="Stop Run tests"');
    expect(html).toContain('aria-label="Close terminal list"');
    expect(html).toContain("<section");
    expect(html).not.toContain("Finished");
    expect(html).not.toContain('aria-label="Open terminals');
  });

  test.each(["running", "completed", "failed", "cancelled", "interrupted"] as const)(
    "foreground commands never enter the tray when %s",
    (kind) => {
      const phase: JobInfo["phase"] =
        kind === "running"
          ? { kind, mode: "foreground" }
          : kind === "failed"
            ? { kind, reason: "exit 1" }
            : { kind };
      expect(render([{ ...command, phase }])).toBe("");
    },
  );
});
