"use client";

import { Button } from "@nyte-ai/ui";
import { IconPlusSmall } from "central-icons";

export function ButtonVariantsDemo() {
  return (
    <>
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </>
  );
}

export function ButtonSizesDemo() {
  return (
    <>
      <Button size="default">Default</Button>
      <Button size="sm">Small</Button>
      <Button size="icon-sm" aria-label="Add">
        <IconPlusSmall size={14} />
      </Button>
    </>
  );
}

export function ButtonStatesDemo() {
  return (
    <>
      <Button disabled>Disabled</Button>
      <Button variant="outline" disabled focusableWhenDisabled>
        Focusable when disabled
      </Button>
    </>
  );
}
