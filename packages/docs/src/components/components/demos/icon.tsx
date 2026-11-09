import { Button } from "@nyte-ai/ui/button";
import { Icon, PanelToggleIcon, SplitPreviewIcon } from "@nyte-ai/ui/icon";
import { useState } from "react";

export function IconDemo() {
  return (
    <>
      <Icon name="folder" />
      <Icon name="warning" variant="filled" />
      <Icon name="warning" size="sm" label="Warning" />
      <Icon name="sparkle" size="xs" />
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

export function SplitPreviewIconDemo() {
  return (
    <>
      <Button iconOnly aria-label="Split Right">
        <SplitPreviewIcon side="right" />
      </Button>
      <Button iconOnly aria-label="Split Down">
        <SplitPreviewIcon side="down" />
      </Button>
    </>
  );
}
