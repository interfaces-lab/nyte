"use client";

import { Autocomplete } from "@nyte-ai/ui/autocomplete";
import { useState } from "react";

interface ModelGroup {
  readonly label: string;
  readonly items: readonly string[];
}

const groups: readonly ModelGroup[] = [
  { label: "Anthropic", items: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"] },
  { label: "OpenAI", items: ["gpt-5.2"] },
  { label: "Google", items: ["gemini-3-pro"] },
];

export function AutocompleteDemo() {
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [search, setSearch] = useState("");

  return (
    <Autocomplete.Root
      items={groups}
      value={search}
      autoHighlight
      onValueChange={setSearch}
      onOpenChange={(open) => {
        if (!open) setSearch("");
      }}
    >
      <Autocomplete.Trigger aria-label="Model">{model}</Autocomplete.Trigger>
      <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4}>
          <Autocomplete.Popup>
            <Autocomplete.Input aria-label="Search models" placeholder="Search models" />
            <Autocomplete.List>
              {(group: ModelGroup, index: number) => (
                <Autocomplete.Group key={group.label} items={group.items}>
                  {index > 0 && <Autocomplete.Separator />}
                  <Autocomplete.GroupLabel>{group.label}</Autocomplete.GroupLabel>
                  <Autocomplete.Collection>
                    {(item: string) => (
                      <Autocomplete.Item
                        key={item}
                        value={item}
                        selected={item === model}
                        onClick={() => setModel(item)}
                      >
                        {item}
                      </Autocomplete.Item>
                    )}
                  </Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>
            <Autocomplete.Empty>No models match</Autocomplete.Empty>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
