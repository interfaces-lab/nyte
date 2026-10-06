"use client";

import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteSeparator,
  AutocompleteTrigger,
} from "@nyte-ai/ui/autocomplete";
import { useState } from "react";
import { modelId } from "~/lib/shared";

interface ModelGroup {
  readonly label: string;
  readonly items: readonly string[];
}

const groups: readonly ModelGroup[] = [
  { label: "Anthropic", items: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"] },
  { label: "OpenAI", items: [modelId] },
  { label: "Google", items: ["gemini-3-pro"] },
];

export function AutocompleteDemo() {
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [search, setSearch] = useState("");

  return (
    <Autocomplete
      items={groups}
      value={search}
      autoHighlight
      onValueChange={setSearch}
      onOpenChange={(open) => {
        if (!open) setSearch("");
      }}
    >
      <AutocompleteTrigger aria-label="Model">{model}</AutocompleteTrigger>
      <AutocompleteContent>
        <AutocompleteInput aria-label="Search models" placeholder="Search models" />
        <AutocompleteList>
          {(group: ModelGroup, index: number) => (
            <AutocompleteGroup key={group.label} items={group.items}>
              {index > 0 && <AutocompleteSeparator />}
              <AutocompleteGroupLabel>{group.label}</AutocompleteGroupLabel>
              <AutocompleteCollection>
                {(item: string) => (
                  <AutocompleteItem
                    key={item}
                    value={item}
                    selected={item === model}
                    onClick={() => setModel(item)}
                  >
                    {item}
                  </AutocompleteItem>
                )}
              </AutocompleteCollection>
            </AutocompleteGroup>
          )}
        </AutocompleteList>
        <AutocompleteEmpty>No models match</AutocompleteEmpty>
      </AutocompleteContent>
    </Autocomplete>
  );
}
