const RELAUNCH_CLEANUP_TIMEOUT_MS = 10_000;

type RelaunchCleanupResult =
  | { readonly kind: "completed" }
  | { readonly kind: "timed-out" }
  | { readonly kind: "failed"; readonly message: string };

export async function runRelaunchCleanup({
  cleanup,
  timeoutMs = RELAUNCH_CLEANUP_TIMEOUT_MS,
}: {
  readonly cleanup: () => Promise<void>;
  readonly timeoutMs?: number;
}): Promise<RelaunchCleanupResult> {
  let timeout: NodeJS.Timeout | undefined;

  const deadline = new Promise<RelaunchCleanupResult>((resolve) => {
    timeout = setTimeout(() => resolve({ kind: "timed-out" }), timeoutMs);
  });

  const operation = (async (): Promise<RelaunchCleanupResult> => {
    try {
      await cleanup();

      return { kind: "completed" };
    } catch (cause) {
      return { kind: "failed", message: errorMessage(cause) };
    }
  })();

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
