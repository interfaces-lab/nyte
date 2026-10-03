import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";

const MissingPathError = Type.Object({
  code: Type.Union([Type.Literal("ENOENT"), Type.Literal("ENOTDIR")]),
});

const fileMutationQueues = new Map<string, Promise<void>>();
let registrationQueue = Promise.resolve();

async function getMutationQueueKey(filePath: string): Promise<string> {
  const resolvedPath = resolve(filePath);
  try {
    return await realpath(resolvedPath);
  } catch (error) {
    if (Value.Check(MissingPathError, error)) {
      return resolvedPath;
    }
    throw error;
  }
}

/**
 * Serialize file mutation operations targeting the same file.
 * Operations for different files still run in parallel.
 */
export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const registration = registrationQueue.then(async () => {
    const key = await getMutationQueueKey(filePath);
    const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();

    const next = Promise.withResolvers<void>();
    const nextQueue = next.promise;
    const releaseNext = next.resolve;
    const chainedQueue = currentQueue.then(() => nextQueue);
    fileMutationQueues.set(key, chainedQueue);

    return { key, currentQueue, chainedQueue, releaseNext };
  });
  registrationQueue = registration.then(
    () => undefined,
    () => undefined,
  );

  const { key, currentQueue, chainedQueue, releaseNext } = await registration;
  await currentQueue;
  try {
    return await fn();
  } finally {
    releaseNext();
    if (fileMutationQueues.get(key) === chainedQueue) {
      fileMutationQueues.delete(key);
    }
  }
}
