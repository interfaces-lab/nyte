"use client";

import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { useState } from "react";

export function ToggleDemo() {
  const [pinned, setPinned] = useState(true);

  return (
    <>
      <Toggle
        size="icon"
        icon="pin"
        aria-label="Pin"
        pressed={pinned}
        onPressedChange={setPinned}
      />
      <Toggle icon="eye" defaultPressed>
        Preview
      </Toggle>
    </>
  );
}

export function ToggleGroupDemo() {
  return (
    <ToggleGroup defaultValue={["medium"]} aria-label="Effort">
      <Toggle value="low" size="sm">
        Low
      </Toggle>
      <Toggle value="medium" size="sm">
        Medium
      </Toggle>
      <Toggle value="high" size="sm">
        High
      </Toggle>
    </ToggleGroup>
  );
}

export function ToggleGroupMultipleDemo() {
  return (
    <ToggleGroup multiple defaultValue={["sidebar"]} aria-label="Panels">
      <Toggle value="sidebar" size="icon-sm" icon="panel-left" aria-label="Sidebar" />
      <Toggle value="terminal" size="icon-sm" icon="console" aria-label="Terminal" />
      <Toggle value="inspector" size="icon-sm" icon="panel-right" aria-label="Inspector" />
    </ToggleGroup>
  );
}
