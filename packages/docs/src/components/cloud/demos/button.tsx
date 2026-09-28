"use client";

import { Button } from "@nyte-ai/ui";

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
      <Button variant="secondary">Default</Button>
      <Button variant="secondary" size="condensed">
        Condensed
      </Button>
      <Button variant="secondary" size="sm">
        Small
      </Button>
      <Button size="icon" icon="plus" aria-label="Add" />
      <Button size="icon-sm" icon="plus" aria-label="Add" />
      <Button size="icon-xs" icon="x" aria-label="Remove" />
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
