import "../../test/window-bridge.ts";
import { asId } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../theme/tokens.stylex.ts";
import type { ToolMessage } from "../view-helpers.ts";
import { ToolCallView } from "./tool-call.tsx";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const frame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

const LINE =
  "FAIL src/foo.test.ts > adds numbers \u001b[31mAssertionError: expected 2 to be 3\u001b[0m at /repo/src/foo.test.ts:42:7\n";

const LOG = `first line\n${LINE.repeat(Math.ceil((5 * 1024 * 1024) / LINE.length))}last line`;

const message: ToolMessage = {
  id: asId<"message">("tool-1"),
  turn: asId<"turn">("turn-1"),
  at: 1,
  kind: "part",
  part: asId<"part">("tool-1"),
  partKind: "tool",
  role: "step",
  version: 1,
  status: { kind: "settled", commit: asId<"commit">("commit-1"), endedAt: 1 },
  state: {
    call: asId<"call">("call-1"),
    name: "mcp__github__get_job_logs",
    args: {},
    class: { kind: "custom", label: "mcp__github__get_job_logs" },
    phase: "settled",
    outcome: { kind: "ok", content: [{ kind: "text", text: LOG }], output: null, parts: [] },
    changes: null,
  },
};

export async function run(): Promise<string> {
  applyDisplayMode("light");
  const host = document.createElement("div");
  host.style.width = "640px";
  document.body.append(host);
  const root = createRoot(host);

  try {
    const started = performance.now();
    flushSync(() => root.render(<ToolCallView message={message} cwd="/repo" density="compact" />));
    const mounted = performance.now() - started;
    check(mounted < 40, `Mounting a 5 MB tool row took ${mounted.toFixed(0)} ms`);
    const collapsed = (host.textContent ?? "").length;
    check(collapsed < 40_000, `A collapsed row draws ${String(collapsed)} characters`);

    const trigger = host.querySelector("button");
    check(trigger !== null, "The row expands");
    trigger?.click();
    await frame();
    await frame();
    const region = host.querySelector('[aria-label="Tool output"]');
    const excerpt = region?.textContent ?? "";
    check(
      excerpt.length > 0 && excerpt.length < 40_000,
      `The open row draws ${String(excerpt.length)} characters`,
    );
    check(excerpt.startsWith("first line"), "The open row starts at the head");
    check(excerpt.endsWith("last line"), "The open row ends at the tail");
    check(!excerpt.includes("\u001b"), "The excerpt is terminal text");

    const more = [...(region?.querySelectorAll("button") ?? [])].find((button) =>
      /^Show .* more$/.test(button.textContent ?? ""),
    );

    check(more !== undefined, "The open row offers the rest");
    more?.click();
    await frame();
    const whole = region?.textContent ?? "";
    check(whole.length > 4_000_000, `Show more draws ${String(whole.length)} characters`);

    return "passed";
  } finally {
    root.unmount();
    host.remove();
  }
}
