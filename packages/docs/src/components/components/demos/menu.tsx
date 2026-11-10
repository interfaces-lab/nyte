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
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuSwitchItem,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { useState } from "react";

export function MenuDemo() {
  const [effort, setEffort] = useState("medium");
  const [pinned, setPinned] = useState(false);

  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline">Session</Button>} />
      <MenuContent>
        <MenuGroup>
          <MenuGroupLabel>Session</MenuGroupLabel>
          <MenuItem icon="pencil" meta="⌘R" onClick={() => {}}>
            Rename
          </MenuItem>
          <MenuItem icon="copy" onClick={() => {}}>
            Duplicate
          </MenuItem>
          <MenuItem icon="archive" disabled>
            Archive
          </MenuItem>
          <MenuSwitchItem icon="pin" checked={pinned} onCheckedChange={setPinned}>
            Pinned
          </MenuSwitchItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuSub>
          <MenuSubTrigger icon="bolt" value={effort.charAt(0).toUpperCase() + effort.slice(1)}>
            Effort
          </MenuSubTrigger>
          <MenuSubContent>
            <MenuRadioGroup value={effort} onValueChange={setEffort}>
              <MenuRadioItem value="low">Low</MenuRadioItem>
              <MenuRadioItem value="medium">Medium</MenuRadioItem>
              <MenuRadioItem value="high">High</MenuRadioItem>
            </MenuRadioGroup>
          </MenuSubContent>
        </MenuSub>
        <MenuSeparator />
        <MenuItem icon="trash" variant="danger" onClick={() => {}}>
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
