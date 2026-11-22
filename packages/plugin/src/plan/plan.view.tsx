import { useState } from "react";
import { Button, Card, FileLink, Icon, Meter, Stack, Text } from "nyte/canvas";
import type { PlanState } from "./plan-file.ts";

export default function PlanCard(props: {
  readonly state: PlanState;
  readonly act: (action: string, input?: object) => Promise<unknown>;
}) {
  const state = props.state;
  const [building, setBuilding] = useState(false);
  const done = state.todos.filter((todo) => todo.done).length;

  const build = (): void => {
    setBuilding(true);
    void props.act("build", {}).finally(() => setBuilding(false));
  };

  return (
    <Card
      title={
        <Stack direction="row" gap={2} align="center">
          <Icon name="square-checklist" />
          <Text weight="semibold">{state.name}</Text>
        </Stack>
      }
      description={state.overview}
      actions={
        <Button
          variant={state.built ? "ghost" : "solid"}
          tone={state.built ? "neutral" : "primary"}
          size="sm"
          pill
          loading={building}
          disabled={state.built}
          onClick={build}
        >
          {state.built ? "Built" : "Build"}
        </Button>
      }
    >
      <Stack gap={3}>
        {state.built && (
          <Meter value={done} max={Math.max(1, state.todos.length)} label="To-dos" tone="success" />
        )}
        <Stack gap={1}>
          {state.todos.map((todo, index) => (
            <Stack key={index} direction="row" gap={2} align="start">
              <Text tone={todo.done ? "secondary" : "tertiary"}>
                <Icon name={todo.done ? "checkmark" : "square"} size="xs" />
              </Text>
              <Text size="sm" tone={todo.done ? "tertiary" : "primary"}>
                {todo.content}
              </Text>
            </Stack>
          ))}
        </Stack>
        <FileLink path={state.path} />
      </Stack>
    </Card>
  );
}
