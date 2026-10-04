import type { ExecutionEnv } from "../../kernel/loop/env.ts";

const fileMutationQueues = new Map<string, Promise<void>>();
let registrationQueue = Promise.resolve();

/**
 * Serialize `edit` and `write` mutations of one file within this process: same
 * filesystem and canonical path, whichever environment object the call got.
 * Other files, and other filesystems, never wait. Not a lock against `bash`
 * or other processes.
 */
export async function withFileMutationQueue<T>(
  env: ExecutionEnv,
  absolutePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const registration = registrationQueue.then(async () => {
    const key = `${env.fs}\0${(await env.realpath(absolutePath)) ?? absolutePath}`;
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
