import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { useCatalog } from "../../data/catalog.ts";
import { useConfigureSession, useSessionChoice } from "../../data/sessions.ts";
import { ModelPicker, type ModelPickerChange } from "./model-picker.tsx";
import { modelRefFor, selectedModelOption } from "./model-picker-state.ts";

export function SessionModelChip({
  sessionId,
  open,
  onOpenChange,
}: {
  sessionId: SessionId;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): ReactElement | null {
  const catalog = useCatalog(sessionId);
  const choice = useSessionChoice(sessionId);
  const configure = useConfigureSession(sessionId);
  const options = catalog.data?.models ?? [];
  const selected = selectedModelOption(options, choice?.model);
  const current = selected?.option;
  const thinkingLevel = choice?.thinking;

  const handleChange = (change: ModelPickerChange) =>
    configure.mutate({
      model: modelRefFor(change.option, change.fast),
      thinking: change.thinkingLevel,
    });

  return (
    <>
      <ModelPicker
        catalog={catalog.data}
        current={current}
        thinkingLevel={thinkingLevel}
        fast={selected?.fast === true}
        loading={catalog.isPending}
        disabled={catalog.isError}
        open={open}
        onOpenChange={onOpenChange}
        onChange={handleChange}
      />
      {catalog.isError && (
        <Button size="sm" onClick={() => void catalog.refetch()} loading={catalog.isFetching}>
          Retry Models
        </Button>
      )}
    </>
  );
}
