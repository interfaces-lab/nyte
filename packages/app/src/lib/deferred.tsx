import { Suspense, use } from "react";
import type { ReactElement, ReactNode } from "react";
import type { DeferredRuntimes } from "./deferred-entries.ts";
import deferredUrls from "./deferred-urls.ts";

type DeferredName = keyof DeferredRuntimes;

const published: { [Name in DeferredName]?: DeferredRuntimes[Name] } = {};

const loading = new Map<DeferredName, Promise<void>>();

const attempts = new Map<DeferredName, number>();

const LOAD_TIMEOUT_MS = 15_000;

export function publishDeferred<Name extends DeferredName>(
  name: Name,
  runtime: DeferredRuntimes[Name],
): void {
  published[name] = runtime;
}

export function readDeferred<Name extends DeferredName>(
  name: Name,
): DeferredRuntimes[Name] | undefined {
  return published[name];
}

export function loadDeferred<Name extends DeferredName>(
  name: Name,
): Promise<DeferredRuntimes[Name]> {
  const ready = published[name];

  if (ready !== undefined) return Promise.resolve(ready);

  return loadEntry(name).then(() => requirePublished(name));
}

function useDeferred<Name extends DeferredName>(name: Name): DeferredRuntimes[Name] {
  if (published[name] === undefined) use(loadEntry(name));

  return requirePublished(name);
}

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

function loadEntry(name: DeferredName): Promise<void> {
  const started = loading.get(name);

  if (started !== undefined) return started;

  const pending = injectEntry(name);

  loading.set(name, pending);

  return pending;
}

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
