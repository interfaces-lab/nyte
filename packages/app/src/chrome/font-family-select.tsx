/** Searchable font family picker. Theme stays on Select. */
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
  AutocompleteStatus,
  AutocompleteTrigger,
  type AutocompleteContentProps,
} from "@nyte-ai/ui/autocomplete";
import { useState } from "react";
import type { ReactElement } from "react";
import { selectedFontOption, type FontOption, type FontSelectGroup } from "./font-select-groups.ts";

const FONT_SELECT_COLLISION: NonNullable<AutocompleteContentProps["collisionAvoidance"]> = {
  side: "flip",
  align: "shift",
  fallbackAxisSide: "none",
};

export function FontFamilySelect<T extends string>({
  label,
  value,
  groups,
  disabled = false,
  loading = false,
  onValueChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly groups: readonly FontSelectGroup<T>[];
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly onValueChange: (value: T) => void;
}): ReactElement {
  const [search, setSearch] = useState("");
  const selected = selectedFontOption(groups, value);

  return (
    <Autocomplete
      items={groups}
      value={search}
      disabled={disabled}
      autoHighlight
      onValueChange={setSearch}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setSearch("");
      }}
    >
      <AutocompleteTrigger
        aria-label={label}
        style={selected?.fontFamily === undefined ? undefined : { fontFamily: selected.fontFamily }}
      >
        {selected?.label ?? value}
      </AutocompleteTrigger>
      <AutocompleteContent align="end" collisionAvoidance={FONT_SELECT_COLLISION}>
        <AutocompleteInput aria-label="Search fonts" placeholder="Search fonts" />
        <AutocompleteStatus>{loading ? "Loading fonts..." : null}</AutocompleteStatus>
        <AutocompleteList data-nyte-scrollport>
          {(group: FontSelectGroup<T>, index: number) => (
            <AutocompleteGroup key={group.id} items={group.items}>
              {group.title !== undefined && (
                <>
                  {index > 0 && <AutocompleteSeparator />}
                  <AutocompleteGroupLabel>{group.title}</AutocompleteGroupLabel>
                </>
              )}
              <AutocompleteCollection>
                {(option: FontOption<T>) => (
                  <AutocompleteItem
                    key={option.value}
                    value={option}
                    selected={option.value === value}
                    style={
                      option.fontFamily === undefined
                        ? undefined
                        : { fontFamily: option.fontFamily }
                    }
                    onClick={() => {
                      onValueChange(option.value);
                    }}
                  >
                    {option.label}
                  </AutocompleteItem>
                )}
              </AutocompleteCollection>
            </AutocompleteGroup>
          )}
        </AutocompleteList>
        <AutocompleteEmpty>No fonts match &quot;{search}&quot;</AutocompleteEmpty>
      </AutocompleteContent>
    </Autocomplete>
  );
}
