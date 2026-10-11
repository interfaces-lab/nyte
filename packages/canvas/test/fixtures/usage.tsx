import { useState } from "react";
import {
  Badge,
  Card,
  Grid,
  Heading,
  Meter,
  Sparkline,
  Stack,
  StackedBars,
  Stat,
  Table,
  Text,
  Toggle,
  ToggleGroup,
} from "nyte/canvas";

const days = [
  "Mon 3",
  "Tue 4",
  "Wed 5",
  "Thu 6",
  "Fri 7",
  "Sat 8",
  "Sun 9",
  "Mon 10",
  "Tue 11",
  "Wed 12",
  "Thu 13",
  "Fri 14",
];

const input = [1.8, 2.4, 2.1, 2.9, 3.4, 0.6, 0.4, 2.7, 3.1, 3.6, 2.8, 2.2];

const output = [0.9, 1.1, 1.0, 1.4, 1.7, 0.3, 0.2, 1.3, 1.6, 1.9, 1.4, 1.1];

const cache = [0.3, 0.5, 0.4, 0.6, 0.8, 0.1, 0.1, 0.6, 0.7, 0.9, 0.6, 0.5];

const folders = [
  {
    name: "nyte",
    spend: 41.2,
    share: 0.46,
    turns: 318,
    trend: [2, 3, 3, 4, 5, 1, 1, 4, 5, 5, 4, 3],
  },
  {
    name: "docs-site",
    spend: 22.7,
    share: 0.25,
    turns: 141,
    trend: [1, 1, 2, 2, 2, 0, 0, 2, 3, 3, 2, 2],
  },
  {
    name: "mobile",
    spend: 15.1,
    share: 0.17,
    turns: 96,
    trend: [0, 1, 1, 1, 2, 0, 0, 1, 1, 2, 2, 1],
  },
  { name: "lab", spend: 6.4, share: 0.07, turns: 40, trend: [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1] },
  {
    name: "other",
    spend: 4.3,
    share: 0.05,
    turns: 27,
    trend: [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0],
  },
];

const usd = (value: number) => `$${value.toFixed(2)}`;

export default function Usage() {
  const [window, setWindow] = useState<string[]>(["14d"]);

  return (
    <Stack gap={4}>
      <Stack direction="row" align="center" justify="between">
        <Heading>Spend, last 14 days</Heading>
        <ToggleGroup
          value={window}
          onValueChange={(next) => setWindow(next.length === 0 ? window : next)}
        >
          <Toggle value="7d">7d</Toggle>
          <Toggle value="14d">14d</Toggle>
          <Toggle value="30d">30d</Toggle>
        </ToggleGroup>
      </Stack>
      <Grid columns={3} gap={3}>
        <Card padding={3}>
          <Stack gap={3}>
            <Stat label="Spend" value="$89.70" detail="+12% vs prior 14 days" tone="warning" />
            <StackedBars
              label="Spend per day by token kind"
              series={[
                { key: "input", label: "Input", tint: "blue" },
                { key: "output", label: "Output", tint: "purple" },
                { key: "cache", label: "Cache", tint: "teal" },
              ]}
              buckets={days.map((day, index) => ({
                key: day,
                label: day,
                values: [input[index] ?? 0, output[index] ?? 0, cache[index] ?? 0],
              }))}
              format={usd}
              height={72}
              ticks={4}
            />
          </Stack>
        </Card>
        <Card padding={3}>
          <Stack gap={3}>
            <Stat label="Cache hit rate" value="38%" detail="+4 pt" tone="success" />
            <StackedBars
              label="Cache reads per day"
              series={[{ key: "cache", label: "Cache reads", tint: "teal" }]}
              buckets={days.map((day, index) => ({
                key: day,
                label: day,
                values: [cache[index] ?? 0],
              }))}
              format={usd}
              height={72}
              ticks={4}
            />
          </Stack>
        </Card>
        <Card padding={3}>
          <Stack gap={3}>
            <Stat label="Weekly limit" value="64%" detail="Resets Sunday" />
            <Meter label="Claude Max" value={64} />
            <Meter label="OpenAI Pro" value={91} tone="warning" />
            <Meter label="Gemini" value={12} tone="success" />
          </Stack>
        </Card>
      </Grid>
      <Card title="By folder" padding={0}>
        <Table
          columns={[
            { key: "name", label: "Folder" },
            { key: "spend", label: "Spend", align: "end" },
            { key: "share", label: "Share", align: "end" },
            { key: "turns", label: "Turns", align: "end" },
            { key: "trend", label: "Trend", width: 96 },
            { key: "status", label: "" },
          ]}
          rows={folders.map((folder, index) => ({
            name: <Text weight="medium">{folder.name}</Text>,
            spend: usd(folder.spend),
            share: `${Math.round(folder.share * 100)}%`,
            turns: folder.turns,
            trend: (
              <Sparkline
                values={folder.trend}
                tint={index < 3 ? "blue" : "gray"}
                label={`${folder.name} trend`}
              />
            ),
            status: index === 0 ? <Badge tone="info">Top</Badge> : null,
          }))}
          caption="Spend by folder, with each row's trend across the window."
        />
      </Card>
    </Stack>
  );
}
