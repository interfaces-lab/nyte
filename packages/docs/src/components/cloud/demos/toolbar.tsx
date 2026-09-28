"use client";

import { Button } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { Toolbar } from "@nyte-ai/ui/toolbar";

export function ToolbarDemo() {
  return (
    <Toolbar.Root aria-label="Layout">
      <Toolbar.Group aria-label="Panels">
        <Toolbar.Button
          render={<Toggle size="icon" icon="panel-left" aria-label="Sidebar" defaultPressed />}
        />
        <Toolbar.Button render={<Toggle size="icon" icon="console" aria-label="Terminal" />} />
      </Toolbar.Group>
      <Toolbar.Separator />
      <Toolbar.Button render={<Button size="icon" icon="refresh" aria-label="Refresh" />} />
      <Toolbar.Button render={<Button size="icon" icon="trash" aria-label="Delete" />} />
    </Toolbar.Root>
  );
}
