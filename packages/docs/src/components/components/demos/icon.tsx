"use client";

import { Button } from "@nyte-ai/ui/button";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import { useState } from "react";

export function IconDemo() {
  return (
    <>
      <Icon name="folder" />
      <Icon name="folder" variant="filled" />
      <Icon name="warning" size={14} label="Warning" />
      <Icon name="sparkle" size={12} />
    </>
  );
}

export function PanelToggleIconDemo() {
  const [visible, setVisible] = useState(true);

  return (
    <Button
      iconOnly
      aria-label={visible ? "Hide sidebar" : "Show sidebar"}
      onClick={() => setVisible(!visible)}
    >
      <PanelToggleIcon side="left" visible={visible} />
    </Button>
  );
}
