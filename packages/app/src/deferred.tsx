/**
 * The one way the interface loads code after startup without `import()`. A
 * deferred entry (listed in `deferred-entries.ts`) builds as its own chunk and
 * publishes its runtime when it evaluates. `loadDeferred` injects the chunk's
 * module script once and resolves with what it published; the chunk imports
 * the startup modules it shares, so both sides see one instance of each.
 */
import { Suspense, use } from "react";
import type { ReactElement, ReactNode } from "react";
import type { DeferredRuntimes } from "./deferred-entries.ts";
import deferredUrls from "./deferred-urls.ts";

export type { DeferredRuntimes } from "./deferred-entries.ts";

type DeferredName = keyof DeferredRuntimes;

const published: { [Name in DeferredName]?: DeferredRuntimes[Name] } = {};

const loading = new Map<DeferredName, Promise<void>>();

const attempts = new Map<DeferredName, number>();

/** How long a chunk may take to load before the attempt counts as failed. */
const LOAD_TIMEOUT_MS = 15_000;

/** Called once by a deferred entry's module, as it evaluates. */
export function publishDeferred<Name extends DeferredName>(
  name: Name,
  runtime: DeferredRuntimes[Name],
): void {
  published[name] = runtime;
}

/** The entry's runtime if its chunk has already loaded. */
export function readDeferred<Name extends DeferredName>(
  name: Name,
): DeferredRuntimes[Name] | undefined {
  return published[name];
}

/** Loads the entry's chunk once, and again after a failed attempt. */
export function loadDeferred<Name extends DeferredName>(
  name: Name,
): Promise<DeferredRuntimes[Name]> {
  const ready = published[name];

  if (ready !== undefined) return Promise.resolve(ready);

  return loadEntry(name).then(() => requirePublished(name));
}

/** The entry's runtime, suspending the component until its chunk has loaded. */
export function useDeferred<Name extends DeferredName>(name: Name): DeferredRuntimes[Name] {
  if (published[name] === undefined) use(loadEntry(name));

  return requirePublished(name);
}

/** Renders `children` with the entry's runtime, and `fallback` while its chunk loads. */
export function Deferred<Name extends DeferredName>({
  entry,
  fallback = null,
  children,
}: {
  readonly entry: Name;
  readonly fallback?: ReactNode;
  readonly children: (runtime: DeferredRuntimes[Name]) => ReactNode;
}): ReactElement {
  return (
    <Suspense fallback={fallback}>
      <DeferredContent entry={entry}>{children}</DeferredContent>
    </Suspense>
  );
}

function DeferredContent<Name extends DeferredName>({
  entry,
  children,
}: {
  readonly entry: Name;
  readonly children: (runtime: DeferredRuntimes[Name]) => ReactNode;
}): ReactNode {
  return children(useDeferred(entry));
}

function requirePublished<Name extends DeferredName>(name: Name): DeferredRuntimes[Name] {
  const runtime = published[name];

  if (runtime === undefined) throw new Error(`The ${name} chunk has not published its runtime`);

  return runtime;
}

/** One load per entry, shared by every caller so `use` sees a stable promise. */
function loadEntry(name: DeferredName): Promise<void> {
  const started = loading.get(name);

  if (started !== undefined) return started;

  const pending = injectEntry(name);

  loading.set(name, pending);

  return pending;
}

/**
 * A failed load forgets itself so the next call retries, under a fresh URL:
 * the module map remembers a failed fetch.
 */
function injectEntry(name: DeferredName): Promise<void> {
  const href = deferredUrls[name];

  if (href === undefined) return Promise.reject(new Error(`${name} is not a deferred entry`));

  const attempt = attempts.get(name) ?? 0;

  const url = new URL(href, window.location.href);

  if (attempt > 0) url.searchParams.set("attempt", String(attempt));
  attempts.set(name, attempt + 1);

  const script = document.createElement("script");

  script.type = "module";
  script.src = url.href;

  return new Promise<void>((resolve, reject) => {
    const fail = (): void => {
      loading.delete(name);
      script.remove();
      reject(new Error(`The ${name} chunk did not load`));
    };

    const timeout = window.setTimeout(fail, LOAD_TIMEOUT_MS);

    script.onload = () => {
      window.clearTimeout(timeout);

      if (published[name] === undefined) fail();
      else resolve();
    };

    script.onerror = () => {
      window.clearTimeout(timeout);
      fail();
    };

    document.head.append(script);
  });
}
