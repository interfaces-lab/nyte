"use client";

import { Button, SplitButton } from "@nyte-ai/ui";
import { Menu, MenuItem } from "@nyte-ai/ui/menu";

export function ButtonVariantsDemo() {
  return (
    <>
      <Button>Ghost</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="solid" tone="primary">
        Solid
      </Button>
      <Button variant="solid" tone="danger">
        Danger
      </Button>
      <Button variant="plain">Plain</Button>
      <Button variant="text">Text</Button>
    </>
  );
}

export function ButtonSizesDemo() {
  return (
    <>
      <Button variant="outline" size="lg">
        Large
      </Button>
      <Button variant="outline">Medium</Button>
      <Button variant="outline" size="sm">
        Small
      </Button>
      <Button iconOnly icon="plus" aria-label="Add" />
      <Button size="sm" iconOnly icon="plus" aria-label="Add" />
      <Button size="2xs" iconOnly icon="x" aria-label="Remove" />
    </>
  );
}

export function ButtonStatesDemo() {
  return (
    <>
      <Button variant="outline" icon="refresh">
        Refresh
      </Button>
      <Button variant="outline" round>
        Round
      </Button>
      <Button variant="outline" disabled disabledReason="No changes to save">
        Save Changes
      </Button>
    </>
  );
}

export function ButtonGroupDemo() {
  return (
    <SplitButton.Root>
      <SplitButton.Main variant="solid" tone="primary">
        Commit and Push
      </SplitButton.Main>
      <Menu
        label="Commit actions"
        align="end"
        trigger={
          <SplitButton.MenuTrigger
            variant="solid"
            tone="primary"
            aria-label="More commit actions"
          />
        }
      >
        <MenuItem onSelect={() => {}}>Commit</MenuItem>
        <MenuItem onSelect={() => {}}>Push</MenuItem>
      </Menu>
    </SplitButton.Root>
  );
}
