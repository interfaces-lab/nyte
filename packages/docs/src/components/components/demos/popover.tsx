"use client";

import { Button } from "@nyte-ai/ui/button";
import { Popover } from "@nyte-ai/ui/popover";
import { create, props } from "@stylexjs/stylex";

const styles = create({
  popup: { display: "flex", flexDirection: "column", gap: 2, width: 240 },
  actions: { display: "flex", justifyContent: "flex-end", marginBlockStart: 8 },
});

export function PopoverDemo() {
  return (
    <Popover.Root>
      <Popover.Trigger render={<Button variant="outline">Notifications</Button>} />
      <Popover.Portal>
        <Popover.Positioner sideOffset={6}>
          <Popover.Popup xstyle={styles.popup}>
            <Popover.Title>Notifications</Popover.Title>
            <Popover.Description>You are all caught up.</Popover.Description>
            <div {...props(styles.actions)}>
              <Popover.Close
                render={
                  <Button size="sm" variant="outline">
                    Close
                  </Button>
                }
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
