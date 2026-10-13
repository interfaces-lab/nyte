import { useState } from "react";
import { useTranscriptScope } from "./transcript.tsx";

const REMEMBERED_STEP_GROUPS = 64;

/** A step group's open state, remembered per session for its most recent groups. */
export function useStepGroupOpen(
  groupKey: string | undefined,
): readonly [boolean | undefined, (open: boolean) => void] {
  const scope = useTranscriptScope();
  const key = groupKey === "" ? undefined : groupKey;
  const read = (): boolean | undefined =>
    scope === undefined || key === undefined
      ? undefined
      : scope.viewStore.readSession(scope.sessionId, scope.paneId).stepGroups.get(key);
  const [open, setOpen] = useState(read);

  const change = (next: boolean): void => {
    setOpen(next);

    if (scope === undefined || key === undefined) return;
    scope.viewStore.updateSession(scope.sessionId, scope.paneId, (current) => {
      const groups = new Map(current.stepGroups);
      groups.delete(key);
      groups.set(key, next);
      const oldest = [...groups.keys()].slice(0, Math.max(0, groups.size - REMEMBERED_STEP_GROUPS));

      for (const stale of oldest) groups.delete(stale);

      return { ...current, stepGroups: groups };
    });
  };

  return [open, change];
}
