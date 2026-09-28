"use client";

import { Select, type SelectOption } from "@nyte-ai/ui/select";
import { useState } from "react";

type Theme = "system" | "light" | "dark";

const themes = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly SelectOption<Theme>[];

export function SelectDemo() {
  const [theme, setTheme] = useState<Theme>("system");

  return <Select<Theme> label="Theme" value={theme} options={themes} onValueChange={setTheme} />;
}
