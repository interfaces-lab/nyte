export type SessionResourceCleanup = (sessionId?: string) => void;

const sessionResourceCleanups = new Set<SessionResourceCleanup>();

const sessionResourceLeases = new Map<string, number>();

export function registerSessionResourceCleanup(cleanup: SessionResourceCleanup): () => void {
  sessionResourceCleanups.add(cleanup);

  return () => {
    sessionResourceCleanups.delete(cleanup);
  };
}

export function cleanupSessionResources(sessionId?: string): void {
  const errors: unknown[] = [];

  for (const cleanup of sessionResourceCleanups) {
    try {
      cleanup(sessionId);
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to cleanup session resources");
  }
}

/**
 * Keep provider caches for a durable session alive while at least one harness
 * owns them. Runtime/model replacement briefly overlaps harnesses, so cleanup
 * belongs to the last release rather than to each harness independently.
 */
export function acquireSessionResources(sessionId: string): () => void {
  sessionResourceLeases.set(sessionId, (sessionResourceLeases.get(sessionId) ?? 0) + 1);
  let released = false;

  return () => {
    if (released) return;
    released = true;
    const remaining = (sessionResourceLeases.get(sessionId) ?? 1) - 1;

    if (remaining > 0) {
      sessionResourceLeases.set(sessionId, remaining);

      return;
    }

    sessionResourceLeases.delete(sessionId);
    cleanupSessionResources(sessionId);
  };
}

/**
 * Keeps `binding` as the session's in `bindings` and holds the session's resources until `signal`
 * aborts. A binding that replaced it by then stays.
 */
export function bindSession<Binding>(
  bindings: Map<string, Binding>,
  sessionId: string,
  binding: Binding,
  signal: AbortSignal,
): void {
  const release = acquireSessionResources(sessionId);
  bindings.set(sessionId, binding);

  const unbind = (): void => {
    if (bindings.get(sessionId) === binding) bindings.delete(sessionId);
    release();
  };

  if (signal.aborted) unbind();
  else signal.addEventListener("abort", unbind, { once: true });
}
