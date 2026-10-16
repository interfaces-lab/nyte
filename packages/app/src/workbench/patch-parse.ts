import type { FileDiffMetadata } from "@pierre/diffs";
import type { PatchParseReply, PatchParseRequest } from "./patch-parse.worker.ts";
// oxlint-disable-next-line import/default -- Vite's `?worker` query supplies the default export
import PatchParseWorker from "./patch-parse.worker.ts?worker";

const IDLE_RELEASE_MS = 30_000;

interface PendingParse {
  readonly resolve: (files: readonly FileDiffMetadata[]) => void;
  readonly reject: (cause: Error) => void;
}

const pending = new Map<number, PendingParse>();

let worker: Worker | undefined;

let idleRelease: number | undefined;

let nextId = 0;

function release(target: Worker, cause: Error | undefined): void {
  if (worker !== target) return;
  target.terminate();
  worker = undefined;
  window.clearTimeout(idleRelease);
  idleRelease = undefined;

  if (cause === undefined) return;
  const failed = [...pending.values()];
  pending.clear();

  for (const parse of failed) parse.reject(cause);
}

function started(): Worker {
  if (worker !== undefined) return worker;
  const created = new PatchParseWorker();

  worker = created;
  created.onmessage = (event: MessageEvent<PatchParseReply>) => {
    const { id, files } = event.data;
    const parse = pending.get(id);
    pending.delete(id);
    parse?.resolve(files ?? []);

    if (pending.size === 0) {
      idleRelease = window.setTimeout(() => release(created, undefined), IDLE_RELEASE_MS);
    }
  };

  const fail = () => release(created, new Error("The patch parser stopped."));
  created.onerror = fail;
  created.onmessageerror = fail;

  return created;
}

export function parsePatch(patch: string, cacheKey: string): Promise<readonly FileDiffMetadata[]> {
  window.clearTimeout(idleRelease);
  idleRelease = undefined;
  const target = started();
  const id = ++nextId;

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });

    try {
      target.postMessage({ id, patch, cacheKey } satisfies PatchParseRequest);
    } catch {
      release(target, new Error("The patch parser stopped."));
    }
  });
}
