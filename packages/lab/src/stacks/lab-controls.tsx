import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import type { DisplayMode } from "../shell/display-mode";

export type Pace = 0 | 1 | 4;

const PACES: readonly { readonly pace: Pace; readonly label: string }[] = [
  { pace: 0, label: "Paused" },
  { pace: 1, label: "1×, a minute every 4 seconds" },
  { pace: 4, label: "4×" },
];

/** Lab only, one button at every width: how the page looks and how fast its fake work moves. */
export function LabControls({
  scheme,
  pace,
  onScheme,
  onPace,
  onReset,
}: {
  readonly scheme: DisplayMode;
  readonly pace: Pace;
  readonly onScheme: (scheme: DisplayMode) => void;
  readonly onPace: (pace: Pace) => void;
  readonly onReset: () => void;
}): ReactElement {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button size="xs" variant="outline" icon="test-tube">
            Lab
          </Button>
        }
      />
      <MenuContent align="end">
        <MenuGroup>
          <MenuGroupLabel>Pace</MenuGroupLabel>
          <MenuRadioGroup
            value={String(pace)}
            onValueChange={(value) => {
              const next = PACES.find((entry) => String(entry.pace) === value);

              if (next !== undefined) onPace(next.pace);
            }}
          >
            {PACES.map((entry) => (
              <MenuRadioItem key={entry.pace} value={String(entry.pace)}>
                {entry.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Scheme</MenuGroupLabel>
          <MenuRadioGroup
            value={scheme}
            onValueChange={(value) => {
              if (value === "light" || value === "dark") onScheme(value);
            }}
          >
            <MenuRadioItem value="light">Light</MenuRadioItem>
            <MenuRadioItem value="dark">Dark</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem icon="refresh" onClick={onReset}>
          Start Over
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
