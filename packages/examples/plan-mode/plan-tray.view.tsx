import { useState } from "react";
import { Button, Icon, Stack, Text } from "nyte/canvas";
import type { TrayState } from "./plan-file.ts";

export default function PlanTray(props: {
  readonly state: TrayState;
  readonly act: (action: string, input?: object) => Promise<unknown>;
}) {
  const state = props.state;
  const [busy, setBusy] = useState(false);

  const run = (action: "build" | "dismiss"): void => {
    setBusy(true);
    void props.act(action, {}).finally(() => setBusy(false));
  };

  return (
    <Stack direction="row" gap={3} align="center" justify="between">
      <Stack direction="row" gap={2} align="center">
        <Icon name="square-checklist" />
        <Text weight="semibold" truncate>
          {state.name}
        </Text>
        <Text size="sm" tone="tertiary">
          {state.done === 0
            ? `${state.todos} to-dos`
            : `${state.done} of ${state.todos} to-dos done`}
        </Text>
      </Stack>
      <Stack direction="row" gap={2} align="center">
        <a href={state.path}>
          <Text size="sm" tone="secondary">
            Open
          </Text>
        </a>
        <Button
          variant="solid"
          tone="primary"
          size="sm"
          pill
          loading={busy}
          onClick={() => run("build")}
        >
          Build
        </Button>
        <Button variant="ghost" size="sm" pill disabled={busy} onClick={() => run("dismiss")}>
          <Icon name="x" label="Dismiss" />
        </Button>
      </Stack>
    </Stack>
  );
}
