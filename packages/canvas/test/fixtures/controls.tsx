import { useState } from "react";
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Collapsible,
  Divider,
  Heading,
  Kbd,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Spinner,
  Stack,
  Switch,
  Tabs,
  Text,
  Toggle,
  ToggleGroup,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useColorScheme,
} from "nyte/canvas";

const regions = ["Europe", "Americas", "Asia Pacific"];

export default function Controls() {
  const [region, setRegion] = useState<string | null>("Europe");
  const [days, setDays] = useState<string[]>(["mon", "wed"]);
  const [alerts, setAlerts] = useState(true);
  const [budget, setBudget] = useState(40);
  const [busy, setBusy] = useState(false);
  const scheme = useColorScheme();

  return (
    <Stack gap={4}>
      <Heading level={1}>Deploy settings</Heading>
      <Tabs.Root defaultValue="general">
        <Tabs.List>
          <Tabs.Tab value="general">General</Tabs.Tab>
          <Tabs.Tab value="schedule">Schedule</Tabs.Tab>
          <Tabs.Tab value="advanced">Advanced</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general">
          <Card>
            <Stack gap={3}>
              <Stack direction="row" align="center" justify="between">
                <Text>Region</Text>
                <Select
                  value={region}
                  onValueChange={setRegion}
                  items={regions.map((name) => ({ value: name, label: name }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {regions.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Stack>
              <Divider />
              <Stack direction="row" align="center" justify="between">
                <Text>Alerts on failure</Text>
                <Switch label="Alerts on failure" checked={alerts} onCheckedChange={setAlerts} />
              </Stack>
              <Divider />
              <Stack direction="row" align="center" gap={2}>
                <Checkbox defaultChecked />
                <Text>Roll back automatically</Text>
              </Stack>
            </Stack>
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="schedule">
          <Card>
            <Stack gap={3}>
              <Text tone="secondary">Deploy days</Text>
              <ToggleGroup value={days} onValueChange={setDays} multiple>
                <Toggle value="mon">Mon</Toggle>
                <Toggle value="tue">Tue</Toggle>
                <Toggle value="wed">Wed</Toggle>
                <Toggle value="thu">Thu</Toggle>
                <Toggle value="fri">Fri</Toggle>
              </ToggleGroup>
              <Slider.Root
                value={budget}
                onValueChange={(value) => setBudget(Array.isArray(value) ? (value[0] ?? 0) : value)}
                min={0}
                max={100}
              >
                <Slider.Label>Error budget</Slider.Label>
                <Slider.Value />
                <Slider.Control>
                  <Slider.Track>
                    <Slider.Indicator />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider.Control>
              </Slider.Root>
            </Stack>
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="advanced">
          <Callout tone="warning" title="Careful">
            These settings apply to every environment at once.
          </Callout>
        </Tabs.Panel>
      </Tabs.Root>
      <Collapsible.Root>
        <Collapsible.Trigger>
          <Collapsible.Chevron />
          Show the plan
        </Collapsible.Trigger>
        <Collapsible.Panel>
          <Text tone="secondary">
            Build, run the smoke tests, then shift traffic over ten minutes.
          </Text>
        </Collapsible.Panel>
      </Collapsible.Root>
      <Stack direction="row" align="center" gap={2}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="solid"
                tone="primary"
                loading={busy}
                onClick={() => setBusy((value) => !value)}
              >
                Deploy
              </Button>
            }
          ></TooltipTrigger>
          <TooltipContent>
            Press <Kbd keys={["⌘", "Enter"]} /> to deploy
          </TooltipContent>
        </Tooltip>
        <Button variant="outline">Cancel</Button>
        {busy ? <Spinner /> : null}
        <Text size="sm" tone="tertiary">
          Scheme: {scheme} · <a href="https://nyte.sh/docs">Docs</a>
        </Text>
      </Stack>
    </Stack>
  );
}
