import { useState, useSyncExternalStore } from "react";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useTranscriptScope } from "./transcript.tsx";

const REMEMBERED_STEP_GROUPS = 64;

const SHOWN_LIVE = "live:";

type Scope = NonNullable<ReturnType<typeof useTranscriptScope>>;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function readGroup(scope: Scope | undefined, key: string | undefined): boolean | undefined {
  return scope === undefined || key === undefined
    ? undefined
    : scope.viewStore.readSession(scope.sessionId).stepGroups.get(key);
}

function writeGroup(scope: Scope, key: string, value: boolean): void {
  scope.viewStore.updateSession(scope.sessionId, (current) => {
    const groups = new Map(current.stepGroups);
    groups.delete(key);
    groups.set(key, value);

    const kind = [...groups.keys()].filter(
      (kept) => kept.startsWith(SHOWN_LIVE) === key.startsWith(SHOWN_LIVE),
    );

    const oldest = kind.slice(0, Math.max(0, kind.length - REMEMBERED_STEP_GROUPS));

    for (const stale of oldest) groups.delete(stale);

    return { ...current, stepGroups: groups };
  });

  for (const listener of listeners) listener();
}

export function useStepGroupOpen(
  groupKey: string | undefined,
): readonly [boolean | undefined, (open: boolean) => void] {
  const scope = useTranscriptScope();
  const key = groupKey === "" ? undefined : groupKey;
  const stored = useSyncExternalStore(subscribe, () => readGroup(scope, key));
  const [local, setLocal] = useState<boolean | undefined>();

  if (scope === undefined || key === undefined) return [local, setLocal];

  return [stored, (next) => writeGroup(scope, key, next)];
}

export function useShownLive(thoughtKey: string | undefined, live: boolean): boolean {
  const scope = useTranscriptScope();
  const key = thoughtKey === undefined ? undefined : `${SHOWN_LIVE}${thoughtKey}`;
  const [shown] = useState(() => live || readGroup(scope, key) === true);

  useMountEffect(() => {
    if (live && scope !== undefined && key !== undefined) writeGroup(scope, key, true);
  });

  return shown;
}
