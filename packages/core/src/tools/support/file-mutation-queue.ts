import type { ExecutionEnv } from "../../kernel/loop/env.ts";

const fileMutationQueues = new Map<string, Promise<void>>();

/** One registration line per environment, so a slow remote `realpath` holds up only its own disk. */
const registrationQueues = new Map<string, Promise<void>>();

/**
 * Serialize `edit` and `write` mutations of one file within this process: same
 * environment id and canonical path, whichever environment object the call got.
 * Other files, and other environments, never wait. Not a lock against `bash`
 * or other processes.
 */
export async function withFileMutationQueue<T>(
  env: ExecutionEnv,
  absolutePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const registrationQueue = registrationQueues.get(env.id) ?? Promise.resolve();

  const registration = registrationQueue.then(async () => {
    const key = `${env.id}\0${(await env.realpath(absolutePath)) ?? absolutePath}`;
    const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();

    const next = Promise.withResolvers<void>();
    const nextQueue = next.promise;
    const releaseNext = next.resolve;
    const chainedQueue = currentQueue.then(() => nextQueue);
    fileMutationQueues.set(key, chainedQueue);

    return { key, currentQueue, chainedQueue, releaseNext };
  });
  const settled = registration.then(
    () => undefined,
    () => undefined,
  );
  registrationQueues.set(env.id, settled);

  const { key, currentQueue, chainedQueue, releaseNext } = await registration;
  await currentQueue;
  try {
    return await fn();
  } finally {
    releaseNext();
    if (fileMutationQueues.get(key) === chainedQueue) {
      fileMutationQueues.delete(key);
    }

    if (registrationQueues.get(env.id) === settled) registrationQueues.delete(env.id);
  }
}
