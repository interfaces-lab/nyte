"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { useState } from "react";

type Theme = "system" | "light" | "dark";

const themes = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly { readonly value: Theme; readonly label: string }[];

export function SelectDemo() {
  const [theme, setTheme] = useState<Theme>("system");

  return (
    <Select
      items={themes}
      value={theme}
      onValueChange={(next) => {
        if (next !== null) setTheme(next);
      }}
    >
      <SelectTrigger aria-label="Theme">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {themes.map((option) => (
          <SelectItem key={option.value} value={option.value} label={option.label}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
