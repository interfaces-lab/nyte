import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { requestHighlight } from "./code-block.tsx";

const workers: FakeWorker[] = [];

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly messages: unknown[] = [];
  terminated = false;

  constructor() {
    workers.push(this);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function requestId(worker: FakeWorker, index: number): number {
  const message = worker.messages[index];
  assert.ok(message !== null && typeof message === "object" && "id" in message);
  if (typeof message.id !== "number") throw new Error("Worker request has no numeric id");
  return message.id;
}

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  for (const worker of workers) worker.onerror?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("an already cancelled highlight does not start a worker", async () => {
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await requestHighlight("one", "typescript", controller.signal), {
    kind: "plain",
  });
  assert.equal(workers.length, 0);
});

test("a failed worker send releases pending highlights", async () => {
  vi.spyOn(FakeWorker.prototype, "postMessage").mockImplementationOnce(() => {
    throw new Error("Worker send failed");
  });
  assert.deepEqual(await requestHighlight("one", "typescript", new AbortController().signal), {
    kind: "plain",
  });
  assert.equal(workers[0]?.terminated, true);
});

test("a null highlight reply completes with the plain-code fallback", async () => {
  const highlighted = requestHighlight(
    "const value = 1",
    "typescript",
    new AbortController().signal,
  );
  const worker = workers[0];
  assert.ok(worker);
  worker.onmessage?.(
    new MessageEvent("message", { data: { id: requestId(worker, 0), html: null } }),
  );
  assert.deepEqual(await highlighted, { kind: "plain" });
  worker.onerror?.();
});

test("a worker error completes every pending highlight and permits a replacement worker", async () => {
  const first = requestHighlight("one", "typescript", new AbortController().signal);
  const second = requestHighlight("two", "typescript", new AbortController().signal);
  const failed = workers[0];
  assert.ok(failed);
  failed.onerror?.();
  assert.deepEqual(await first, { kind: "plain" });
  assert.deepEqual(await second, { kind: "plain" });
  assert.equal(failed.terminated, true);

  const replacement = requestHighlight("three", "typescript", new AbortController().signal);
  const worker = workers[1];
  assert.ok(worker);
  worker.onmessage?.(
    new MessageEvent("message", {
      data: { id: requestId(worker, 0), html: "<pre>three</pre>" },
    }),
  );
  const result = await replacement;
  assert.equal(result.kind, "highlighted");
  if (result.kind !== "highlighted") throw new Error("Replacement worker did not highlight");
  assert.equal(result.value.html, "<pre>three</pre>");
});
