import type { CodeViewSearch } from "@nyte-ai/ui/diffs";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useRef, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { FindWidget } from "../find-widget.tsx";
import type { FindWidgetHandle } from "../find-widget.tsx";

export function EditorFind({
  search,
  onClose,
}: {
  readonly search: CodeViewSearch | undefined;
  readonly onClose: () => void;
}): ReactElement | null {
  const open = useSyncExternalStore(
    search?.subscribe ?? subscribeNothing,
    () => search?.getSnapshot().open ?? false,
  );

  return search !== undefined && open ? <OpenFind search={search} onClose={onClose} /> : null;
}

function subscribeNothing(): () => void {
  return () => {};
}

function OpenFind({
  search,
  onClose,
}: {
  readonly search: CodeViewSearch;
  readonly onClose: () => void;
}): ReactElement {
  const snapshot = useSyncExternalStore(search.subscribe, search.getSnapshot);
  const widget = useRef<FindWidgetHandle>(null);

  useMountEffect(() => {
    let revision = search.getSnapshot().openRevision;

    return search.subscribe(() => {
      const next = search.getSnapshot().openRevision;

      if (next === revision) return;
      revision = next;
      widget.current?.focus();
    });
  });

  return (
    <FindWidget
      ref={widget}
      label="Find in file"
      target={search}
      initialText={snapshot.defaultQuery}
      replace={{
        target: search,
        open: snapshot.mode === "replace",
        onOpenChange: (next) => search.setMode(next ? "replace" : "find"),
      }}
      onClose={onClose}
    />
  );
}
