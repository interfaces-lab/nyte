import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { switchTheme, useTheme } from "~/lib/theme";

const choices = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export function ThemeSwitch() {
  const theme = useTheme().theme;

  return (
    <div className="design-theme">
      <ToggleGroup
        aria-label="Theme"
        value={theme === null ? [] : [theme]}
        onValueChange={(next) => {
          const choice = choices.find((item) => item.value === next[0]);

          if (choice) switchTheme(choice.value);
        }}
      >
        {choices.map((choice) => (
          <Toggle key={choice.value} value={choice.value} size="sm">
            {choice.label}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}
