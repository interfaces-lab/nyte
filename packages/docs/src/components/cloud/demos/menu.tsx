"use client";

import { Button } from "@nyte-ai/ui";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  MenuSwitchItem,
} from "@nyte-ai/ui/menu";
import { useState } from "react";

export function MenuDemo() {
  const [effort, setEffort] = useState("medium");
  const [pinned, setPinned] = useState(false);

  return (
    <Menu label="Session" trigger={<Button variant="outline">Session</Button>}>
      <MenuGroup label="Session">
        <MenuItem icon="pencil" meta="⌘R" onSelect={() => {}}>
          Rename
        </MenuItem>
        <MenuItem icon="copy" onSelect={() => {}}>
          Duplicate
        </MenuItem>
        <MenuSwitchItem icon="pin" checked={pinned} onCheckedChange={setPinned}>
          Pinned
        </MenuSwitchItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuSubmenu label="Effort" icon="bolt" value={effort}>
        <MenuRadioGroup value={effort} onValueChange={setEffort}>
          <MenuRadioItem value="low">low</MenuRadioItem>
          <MenuRadioItem value="medium">medium</MenuRadioItem>
          <MenuRadioItem value="high">high</MenuRadioItem>
        </MenuRadioGroup>
      </MenuSubmenu>
      <MenuSeparator />
      <MenuItem icon="trash" danger onSelect={() => {}}>
        Delete
      </MenuItem>
    </Menu>
  );
}
