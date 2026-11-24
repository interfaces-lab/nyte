import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import type { DeferredRuntimes } from "./deferred-entries.ts";
import deferredUrls from "./deferred-urls.ts";

type DeferredName = keyof DeferredRuntimes;

const published: { [Name in DeferredName]?: DeferredRuntimes[Name] } = {};

const failed = new Set<DeferredName>();

const listeners = new Set<() => void>();

const loading = new Map<DeferredName, Promise<void>>();

const attempts = new Map<DeferredName, number>();

const LOAD_TIMEOUT_MS = 15_000;

export function publishDeferred<Name extends DeferredName>(
  name: Name,
  runtime: DeferredRuntimes[Name],
): void {
  published[name] = runtime;
  failed.delete(name);
  notify();
}

export function readDeferred<Name extends DeferredName>(
  name: Name,
): DeferredRuntimes[Name] | undefined {
  return published[name];
}

export function loadDeferred<Name extends DeferredName>(
  name: Name,
): Promise<DeferredRuntimes[Name]> {
  const ready = readDeferred(name);

  if (ready !== undefined) return Promise.resolve(ready);

  return loadEntry(name).then(() => requirePublished(name));
}

export function useDeferred<Name extends DeferredName>(
  name: Name,
): DeferredRuntimes[Name] | "failed" | undefined {
  return useSyncExternalStore(
    subscribe,
    () => published[name] ?? (failed.has(name) ? "failed" : undefined),
  );
}

export function Deferred<Name extends DeferredName>({
  entry,
  fallback = null,
  children,
}: {
  readonly entry: Name;
  readonly fallback?: ReactNode;
  readonly children: (runtime: DeferredRuntimes[Name]) => ReactNode;
}): ReactNode {
  const runtime = useDeferred(entry);

  useMountEffect(() => {
    void loadDeferred(entry).catch(() => undefined);
  });

  return runtime === undefined || runtime === "failed" ? fallback : children(runtime);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

function requirePublished<Name extends DeferredName>(name: Name): DeferredRuntimes[Name] {
  const runtime = readDeferred(name);

  if (runtime === undefined) throw new Error(`The ${name} chunk has not published its runtime`);

  return runtime;
}

function loadEntry(name: DeferredName): Promise<void> {
  const started = loading.get(name);

  if (started !== undefined) return started;

  if (failed.delete(name)) notify();
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
      failed.add(name);
      notify();
      reject(new Error(`The ${name} chunk did not load`));
    };

    const timeout = window.setTimeout(fail, LOAD_TIMEOUT_MS);

    script.addEventListener("load", () => {
      window.clearTimeout(timeout);

      if (readDeferred(name) === undefined) fail();
      else resolve();
    });

    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      fail();
    });

    document.head.append(script);
  });
}
