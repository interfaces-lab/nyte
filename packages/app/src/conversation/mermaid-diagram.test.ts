import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { renderMermaid } from "./mermaid-diagram.tsx";

const workers: FakeWorker[] = [];

class FakeWorker extends EventTarget {
  readonly messages: unknown[] = [];
  terminated = false;

  constructor() {
    super();
    workers.push(this);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(result: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: { id: "render", result } }));
  }
}

function settled<T>(promise: Promise<T>): Promise<boolean> {
  return Promise.race([promise.then(() => true), Promise.resolve(false)]);
}

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("an already cancelled render starts no worker", async () => {
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await renderMermaid("graph LR\nA --> B", controller.signal), {
    kind: "source",
  });
  assert.equal(workers.length, 0);
});

test("cancelling a render ends its worker before any reply", async () => {
  const controller = new AbortController();
  const render = renderMermaid("graph LR\nA --> B", controller.signal);
  const worker = workers[0];
  assert.ok(worker);
  assert.equal(await settled(render), false);
  assert.equal(worker.terminated, false);

  controller.abort();
  assert.deepEqual(await render, { kind: "source" });
  assert.equal(worker.terminated, true);
});

test("a reply renders the diagram and ends the worker", async () => {
  const controller = new AbortController();
  const render = renderMermaid("graph LR\nA --> B", controller.signal);
  const worker = workers[0];
  assert.ok(worker);
  worker.reply({ kind: "diagram", svg: "<svg/>" });
  assert.deepEqual(await render, { kind: "diagram", svg: "<svg/>" });
  assert.equal(worker.terminated, true);

  controller.abort();
  assert.equal(workers.length, 1);
});

test("a failed worker send releases the worker and settles", async () => {
  vi.spyOn(FakeWorker.prototype, "postMessage").mockImplementationOnce(() => {
    throw new Error("Worker send failed");
  });
  const result = await renderMermaid("graph LR\nA --> B", new AbortController().signal);
  assert.deepEqual(result, { kind: "source" });
  assert.equal(workers[0]?.terminated, true);
});

test("a worker that cannot decode the request falls back to the source", async () => {
  const render = renderMermaid("graph LR\nA --> B", new AbortController().signal);
  const worker = workers[0];
  assert.ok(worker);
  worker.dispatchEvent(new MessageEvent("messageerror"));
  assert.deepEqual(await render, { kind: "source" });
  assert.equal(worker.terminated, true);
});
