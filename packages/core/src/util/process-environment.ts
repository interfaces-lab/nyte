let completed: Promise<void> = Promise.resolve();

/**
 * Resolves once `process.env` is whole: what a child process of this one should inherit and
 * what provider auth reads. Every spawn awaits it just before it starts, and every auth env read
 * before it reads.
 */
export function processEnvironment(): Promise<void> {
  return completed;
}

/**
 * Holds `processEnvironment()` until `completing` settles, for a process that starts before its
 * environment is whole, such as a desktop app opened outside a login shell. A rejection
 * releases the hold as well: spawns and auth then see the environment as it stands.
 */
export function holdProcessEnvironment(completing: Promise<void>): void {
  const previous = completed;

  completed = Promise.all([previous, completing.catch(() => undefined)]).then(() => undefined);
}
