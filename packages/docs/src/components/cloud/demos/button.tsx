"use client";

import { Button, ButtonGroup } from "@nyte-ai/ui";
import { Menu, MenuItem } from "@nyte-ai/ui/menu";

export function ButtonVariantsDemo() {
  return (
    <>
      <Button>Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="inverse">Inverse</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="link">Link</Button>
    </>
  );
}

export function ButtonSizesDemo() {
  return (
    <>
      <Button variant="secondary" size="lg">
        Large
      </Button>
      <Button variant="secondary">Medium</Button>
      <Button variant="secondary" size="sm">
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
      <Button variant="secondary" icon="refresh">
        Refresh
      </Button>
      <Button variant="secondary" round>
        Round
      </Button>
      <Button variant="secondary" disabled>
        Disabled
      </Button>
    </>
  );
}

export function ButtonGroupDemo() {
  return (
    <ButtonGroup>
      <Button variant="inverse">Commit and push</Button>
      <Menu
        label="Commit actions"
        align="end"
        trigger={
          <Button variant="inverse" iconOnly icon="chevron-down" aria-label="More commit actions" />
        }
      >
        <MenuItem onSelect={() => {}}>Commit</MenuItem>
        <MenuItem onSelect={() => {}}>Push</MenuItem>
      </Menu>
    </ButtonGroup>
  );
}
