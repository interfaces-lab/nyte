let completed: Promise<void> = Promise.resolve();

/**
 * Resolves once `process.env` holds what a child process of this one should inherit.
 * Every spawn awaits it just before it starts; nothing else waits on it.
 */
export function childEnvironment(): Promise<void> {
  return completed;
}

/**
 * Holds `childEnvironment()` until `completing` settles, for a process that starts before its
 * environment is whole, such as a desktop app opened outside a login shell. A rejection
 * releases the hold as well: spawns then inherit the environment as it stands.
 */
export function holdChildEnvironment(completing: Promise<void>): void {
  const previous = completed;

  completed = Promise.all([previous, completing.catch(() => undefined)]).then(() => undefined);
}
