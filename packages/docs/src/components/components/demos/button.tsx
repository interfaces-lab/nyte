"use client";

import { Button, SplitButton } from "@nyte-ai/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";

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
      <Button variant="pill">Pill</Button>
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
      <Menu>
        <MenuTrigger
          render={
            <SplitButton.MenuTrigger
              variant="solid"
              tone="primary"
              aria-label="More commit actions"
            />
          }
        />
        <MenuContent align="end">
          <MenuItem onClick={() => {}}>Commit</MenuItem>
          <MenuItem onClick={() => {}}>Push</MenuItem>
        </MenuContent>
      </Menu>
    </SplitButton.Root>
  );
}
