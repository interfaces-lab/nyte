import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ImageLimits, ImageProcessor, PreparedImage } from "@nyte-ai/core";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { photonImages } from "./photon.ts";

export interface NodeImagesOptions {
  readonly worker?: string | URL;
  readonly wasm?: string;
}

export interface PrepareRequest {
  readonly id: number;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly limits: ImageLimits;
}

const size = Type.Object({ width: Type.Number(), height: Type.Number() });

export const prepareReply = Type.Union([
  Type.Object({ id: Type.Integer(), result: Type.Null() }),
  Type.Object({
    id: Type.Integer(),
    result: Type.Object({
      data: Type.String(),
      mimeType: Type.String(),
      resized: Type.Optional(Type.Object({ from: size, to: size })),
    }),
  }),
  Type.Object({ id: Type.Integer(), error: Type.String() }),
]);

const IDLE_MS = 30_000;

export function nodeImages(options: NodeImagesOptions = {}): ImageProcessor {
  const worker =
    options.worker ??
    new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url);

  let wasm: Promise<Uint8Array> | undefined;

  const loadWasm = (): Promise<Uint8Array> =>
    (wasm ??= readFile(options.wasm ?? resolvePhotonWasmPath()));

  let thread: PhotonThread | undefined;
  let inProcess: ImageProcessor | undefined;

  return {
    async prepare(bytes, mimeType, limits) {
      if (inProcess !== undefined) return inProcess.prepare(bytes, mimeType, limits);
      const module = await loadWasm();

      try {
        thread ??= new PhotonThread(worker, module, (ended) => {
          if (thread === ended) thread = undefined;
        });

        return await thread.prepare(bytes, mimeType, limits);
      } catch (cause) {
        if (!(cause instanceof WorkerUnavailable)) throw cause;
        inProcess ??= photonImages(module);

        return inProcess.prepare(bytes, mimeType, limits);
      }
    },
  };
}

export function resolvePhotonWasmPath(): string {
  return fileURLToPath(import.meta.resolve("@silvia-odwyer/photon/photon_rs_bg.wasm"));
}

class WorkerUnavailable extends Error {}

class PhotonThread {
  readonly #worker: Worker;
  readonly #pending = new Map<number, PromiseWithResolvers<PreparedImage | undefined>>();
  readonly #onExit: (ended: PhotonThread) => void;
  #nextId = 0;
  #idle: ReturnType<typeof setTimeout> | undefined;
  #started = false;

  constructor(entry: string | URL, wasm: Uint8Array, onExit: (ended: PhotonThread) => void) {
    this.#onExit = onExit;

    try {
      this.#worker = new Worker(entry, { workerData: wasm });
    } catch (cause) {
      throw new WorkerUnavailable("The image worker cannot start", { cause });
    }

    this.#worker.on("message", (reply: unknown) => {
      if (!Value.Check(prepareReply, reply)) {
        this.#fail(new Error("Malformed image worker reply"));
        void this.#worker.terminate();

        return;
      }

      this.#started = true;
      const request = this.#pending.get(reply.id);

      if (request === undefined) return;
      this.#pending.delete(reply.id);

      if ("error" in reply) request.reject(new Error(reply.error));
      else request.resolve(reply.result ?? undefined);
      this.#settled();
    });

    this.#worker.on("error", (cause) => this.#fail(cause));

    this.#worker.on("exit", (code) =>
      this.#fail(new Error(`The image worker exited with code ${String(code)}`)),
    );
  }

  prepare(
    bytes: Uint8Array,
    mimeType: string,
    limits: ImageLimits,
  ): Promise<PreparedImage | undefined> {
    const id = this.#nextId++;
    const request = Promise.withResolvers<PreparedImage | undefined>();
    this.#pending.set(id, request);
    clearTimeout(this.#idle);
    this.#idle = undefined;
    this.#worker.ref();
    const copy = bytes.slice();

    this.#worker.postMessage({ id, bytes: copy, mimeType, limits } satisfies PrepareRequest, [
      copy.buffer,
    ]);

    return request.promise;
  }

  #settled(): void {
    if (this.#pending.size > 0) return;
    this.#worker.unref();

    this.#idle = setTimeout(() => {
      this.#onExit(this);
      void this.#worker.terminate();
    }, IDLE_MS);

    this.#idle.unref();
  }

  #fail(cause: unknown): void {
    const failure = this.#started
      ? cause
      : new WorkerUnavailable("The image worker cannot start", { cause });

    for (const request of this.#pending.values()) request.reject(failure);
    this.#pending.clear();
    clearTimeout(this.#idle);
    this.#onExit(this);
  }
}
