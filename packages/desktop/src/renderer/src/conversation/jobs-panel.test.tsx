import { afterAll, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionId } from "@nyte-ai/protocol";
import type { JobInfo } from "@nyte-ai/core";
import { BackgroundWork } from "./jobs-panel.tsx";
import { jobStateLabel } from "./jobs-view.ts";
import type { BackgroundWorkSection } from "./jobs-panel.tsx";

vi.hoisted(() => vi.stubGlobal("window", { nyte: {} }));
afterAll(() => vi.unstubAllGlobals());

const id = sessionId("chat");
const command: JobInfo = {
  id: "command",
  kind: "command",
  runId: "run",
  callId: "call",
  head: "main",
  title: "Run tests",
  mode: "background",
  state: "running",
  startedAt: 1,
  updatedAt: 1,
  output: "<script>output</script>",
};
const agent: JobInfo = {
  ...command,
  id: "agent",
  kind: "subagent",
  childSessionId: sessionId("child"),
  title: "Review styling",
  mode: "foreground",
};

function render(jobs?: readonly JobInfo[], open?: BackgroundWorkSection) {
  const client = new QueryClient();
  if (jobs !== undefined) client.setQueryData(["jobs", id], jobs);
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <BackgroundWork
          sessionId={id}
          terminalOwner="test"
          open={open}
          onOpenChange={() => {}}
          onInspect={() => {}}
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
  test("adds nothing to the composer until there is background work", () => {
    expect(render()).toBe("");
    expect(render([])).toBe("");
    expect(render([agent])).not.toContain("Tasks");
  });

  test("uses Working while agents run and keeps recent agents accessible afterwards", () => {
    expect(render([agent])).toContain('aria-label="Agents, Working 1"');
    const finished = render([{ ...agent, state: "completed" }], "agents");
    expect(finished).toContain('aria-label="Agents"');
    expect(finished).not.toContain("Working 1");
    expect(finished).not.toContain("Recent</div>");
    expect(finished).toContain("Review styling");
  });

  test("counts foreground and background agents without counting terminals as agents", () => {
    const html = render([agent, { ...agent, id: "second", mode: "background" }, command]);
    expect(html).toContain('aria-label="Agents, Working 2"');
    expect(html).toContain('aria-label="Open terminals, 1 running"');
    expect(html).toContain(">Terminal</span>");
    expect(html).not.toContain("Review styling");
    expect(html).not.toContain("Run tests");
  });

  test("pluralizes running terminals and retains completed output in recent terminals", () => {
    const html = render([command, { ...command, id: "second" }]);
    expect(html).toContain('aria-label="Open terminals, 2 running"');
    expect(html).toContain(">Terminals</span>");
    const finished = render([{ ...command, state: "completed" }], "terminals");
    expect(finished).toContain("Recent terminals");
    expect(finished).toContain('aria-label="Open terminal for Run tests"');
  });

  test("the active tray only lists its own kind of background work", () => {
    const agents = render([agent, command], "agents");
    expect(agents).toContain('aria-label="View output for Review styling"');
    expect(agents).not.toContain('aria-label="Open terminal for Run tests"');
    const terminals = render([agent, command], "terminals");
    expect(terminals).toContain('aria-label="Open terminal for Run tests"');
    expect(terminals).not.toContain('aria-label="View output for Review styling"');
    expect(terminals).toContain("1 Terminal Running");
  });

  test("each running row has its own stop action; closing the tray is separate", () => {
    const html = render([agent], "agents");
    expect(html).toContain('aria-label="Stop Review styling"');
    expect(html).toContain('aria-label="Close background work"');
    expect(html).not.toContain('aria-label="Agents, Working 1"');
    expect(html).toContain("<section");
    expect(render([agent])).toContain('aria-expanded="false"');
  });

  test.each(["completed", "failed", "cancelled", "interrupted"] as const)(
    "%s work stays inspectable without a stop action",
    (state) => {
      const html = render([{ ...agent, state }], "agents");
      expect(html).not.toContain("Recent</div>");
      expect(html).toContain('aria-label="View output for Review styling"');
      expect(html).not.toContain('aria-label="Stop Review styling"');
      expect(html).toContain(jobStateLabel({ state, mode: agent.mode }));
    },
  );

  test.each(["running", "completed", "failed", "cancelled", "interrupted"] as const)(
    "foreground commands never enter the tray when %s",
    (state) => {
      expect(render([{ ...command, mode: "foreground", state }])).toBe("");
    },
  );

  test("recent history starts with five rows and keeps the rest behind More", () => {
    const jobs = Array.from({ length: 8 }, (_, index): JobInfo => ({
      ...agent,
      id: `recent-${String(index)}`,
      title: `Review ${String(index)}`,
      state: "completed",
      updatedAt: index,
    }));
    const html = render(jobs, "agents");
    expect(html.match(/aria-label="View output for/g)).toHaveLength(5);
    expect(html).toContain("More</button>");
    expect(html).toContain("Review 7");
    expect(html).not.toContain("Review 0");
  });

  test("lists active work before recent work", () => {
    const html = render(
      [{ ...agent, id: "finished", state: "completed", title: "Done review" }, agent],
      "agents",
    );
    expect(html.indexOf('aria-label="View output for Review styling"')).toBeLessThan(
      html.indexOf("1 Recent"),
    );
    expect(html.indexOf("1 Recent")).toBeLessThan(html.indexOf("Done review"));
  });
});
