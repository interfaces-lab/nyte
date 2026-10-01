"use client";

import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@nyte-ai/ui/number-field";

export function NumberFieldDemo() {
  return (
    <NumberField defaultValue={13} min={12} max={16}>
      <NumberFieldGroup>
        <NumberFieldDecrement />
        <NumberFieldInput aria-label="UI font size" />
        <NumberFieldIncrement />
      </NumberFieldGroup>
    </NumberField>
  );
}
