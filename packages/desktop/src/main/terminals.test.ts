import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { HostEvent } from "../shared/ipc.ts";
import { TerminalSessions } from "./terminals.ts";
import { CALL_INPUT_SCHEMAS } from "./ipc-inputs.ts";

const events: HostEvent[] = [];
let terminals: TerminalSessions;

beforeEach(() => {
  events.length = 0;
  terminals = new TerminalSessions((event) => events.push(event), "/bin/bash");
});
afterEach(() => {
  terminals.dispose();
});

function text(id: string): string {
  return events
    .flatMap((event) => (event.kind === "terminal_data" && event.id === id ? [event.data] : []))
    .join("");
}

test("real shells accept input, resize independently, and report exit", async () => {
  const first = terminals.create({ id: "one", cwd: "/private/tmp" });
  terminals.create({ id: "two", cwd: "/private/tmp" });
  assert.equal(first.title, "bash");
  terminals.resize({ id: "one", cols: 91, rows: 29 });
  terminals.write({
    id: "one",
    data: "stty -echo; printf 'TTY='; stty size; printf 'ONE_OK\\n'\r",
  });
  await vi.waitFor(() => assert.match(text("one"), /TTY=29 91/));
  await vi.waitFor(() => assert.match(text("one"), /ONE_OK/));
  assert.doesNotMatch(text("two"), /ONE_OK/);
  terminals.write({ id: "two", data: "exit 7\r" });
  await vi.waitFor(() =>
    assert.ok(
      events.some(
        (event) => event.kind === "terminal_exit" && event.id === "two" && event.exitCode === 7,
      ),
    ),
  );
  assert.throws(() => terminals.write({ id: "two", data: "x" }), /exited/);
  terminals.write({ id: "one", data: "printf 'STILL_RUNNING\\n'\r" });
  await vi.waitFor(() => assert.match(text("one"), /STILL_RUNNING/));
});

test("output waits for renderer acknowledgements and drains without losing bytes", async () => {
  terminals.create({ id: "flood", cwd: "/private/tmp" });
  terminals.write({
    id: "flood",
    data: "stty -echo; dd if=/dev/zero bs=1024 count=512 2>/dev/null | tr '\\000' x; printf '\\nDRAINED\\n'\r",
  });
  await vi.waitFor(() => assert.ok(text("flood").length >= 128 * 1024));
  assert.ok(text("flood").length < 512 * 1024);
  let acknowledged = 0;
  await vi.waitFor(
    () => {
      const current = text("flood").length;
      terminals.acknowledge({ id: "flood", length: current - acknowledged });
      acknowledged = current;
      assert.match(text("flood"), /x\r?\nDRAINED/);
    },
    { timeout: 5000 },
  );
  assert.ok(text("flood").includes("x".repeat(512 * 1024)));
});

test("idle is true at the prompt and false while a foreground job runs", async () => {
  terminals.create({ id: "busy", cwd: "/private/tmp" });
  terminals.write({ id: "busy", data: "stty -echo; printf 'PROMPT_OK\\n'\r" });
  await vi.waitFor(() => assert.match(text("busy"), /PROMPT_OK/));
  assert.equal(terminals.idle({ id: "busy" }), true);
  terminals.write({ id: "busy", data: "sleep 30\r" });
  await vi.waitFor(() => assert.equal(terminals.idle({ id: "busy" }), false));
  terminals.write({ id: "busy", data: "\u0003" });
  await vi.waitFor(() => assert.equal(terminals.idle({ id: "busy" }), true));
  assert.equal(terminals.idle({ id: "missing" }), true);
});

test("closing is idempotent and window disposal ends remaining shells", () => {
  terminals.create({ id: "closed", cwd: "/private/tmp" });
  terminals.close({ id: "closed" });
  terminals.close({ id: "closed" });
  assert.throws(() => terminals.write({ id: "closed", data: "x" }), /exited/);
  terminals.create({ id: "remaining", cwd: "/private/tmp" });
  terminals.dispose();
  assert.throws(() => terminals.write({ id: "remaining", data: "x" }), /exited/);
});

test("IPC rejects invalid sizes, oversized writes, and command injection at creation", () => {
  assert.throws(() =>
    CALL_INPUT_SCHEMAS["host.terminal.create"].Parse({
      id: "one",
      workspacePath: null,
      command: "touch unexpected",
    }),
  );
  assert.throws(() =>
    CALL_INPUT_SCHEMAS["host.terminal.resize"].Parse({ id: "one", cols: 0, rows: 24 }),
  );
  assert.throws(() =>
    CALL_INPUT_SCHEMAS["host.terminal.resize"].Parse({ id: "one", cols: 80.5, rows: 24 }),
  );
  assert.throws(() =>
    CALL_INPUT_SCHEMAS["host.terminal.write"].Parse({ id: "one", data: "a".repeat(65537) }),
  );
});
