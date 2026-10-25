import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { useCatalog, useConfigureSession, useSessionChoice } from "../queries.ts";
import { ModelPicker, type ModelPickerChange } from "./model-picker.tsx";
import { modelRefFor, selectedModelOption } from "./model-picker-state.ts";

export function SessionModelChip({ sessionId }: { sessionId: SessionId }): ReactElement | null {
  const catalog = useCatalog(sessionId);
  const choice = useSessionChoice(sessionId);
  const configure = useConfigureSession(sessionId);
  const options = catalog.data?.models ?? [];
  const selected = selectedModelOption(options, choice?.model);
  const current = selected?.option;
  const thinkingLevel = choice?.thinking;

  const handleChange = (change: ModelPickerChange) => {
    switch (change.kind) {
      case "model":
        configure.mutate({
          model: { provider: change.option.provider, id: change.option.id },
          thinking: change.thinkingLevel,
        });

        return;
      case "thinking":
        configure.mutate({ thinking: change.thinkingLevel });

        return;
      case "fast":
        if (current !== undefined)
          configure.mutate({ model: modelRefFor(current, change.enabled) });

        return;
      default: {
        const _exhaustive: never = change;

        return _exhaustive;
      }
    }
  };

  return (
    <>
      <ModelPicker
        catalog={catalog.data}
        current={current}
        thinkingLevel={thinkingLevel}
        fast={selected?.fast === true}
        loading={catalog.isPending}
        disabled={catalog.isError}
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
