"use client";

import { NumberField } from "@nyte-ai/ui/number-field";
import { useState } from "react";

export function NumberFieldDemo() {
  const [size, setSize] = useState(13);

  return (
    <NumberField label="UI font size" value={size} min={12} max={16} onValueChange={setSize} />
  );
}
