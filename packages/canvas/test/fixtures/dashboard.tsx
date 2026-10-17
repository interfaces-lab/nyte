import { useMemo } from "react";
import {
  Badge,
  BarChart,
  Card,
  Grid,
  LineChart,
  Meter,
  PieChart,
  Stack,
  Stat,
  Table,
  Text,
} from "nyte/canvas";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];

const revenue = [42, 48, 51, 47, 58, 64, 71, 78];

const costs = [31, 33, 35, 36, 38, 41, 43, 46];

const sources = [
  { id: "Organic", value: 44 },
  { id: "Referral", value: 23 },
  { id: "Paid", value: 18 },
  { id: "Direct", value: 15 },
];

const money = (value: number) => `$${value}k`;

export default function Dashboard() {
  const rows = useMemo(
    () =>
      months.map((month, index) => ({
        month,
        revenue: money(revenue[index] ?? 0),
        costs: money(costs[index] ?? 0),
        margin: `${Math.round((((revenue[index] ?? 0) - (costs[index] ?? 0)) / (revenue[index] ?? 1)) * 100)}%`,
        status:
          index >= 5 ? <Badge tone="success">On plan</Badge> : <Badge tone="neutral">Closed</Badge>,
      })),
    [],
  );

  return (
    <Stack gap={4}>
      <Grid minWidth={140} gap={3}>
        <Stat label="Revenue" value="$78k" detail="+9.9% vs last month" tone="success" />
        <Stat label="Costs" value="$46k" detail="+7.0% vs last month" tone="warning" />
        <Stat label="Margin" value="41%" detail="Best this year" tone="success" />
        <Stat label="Churn" value="2.1%" detail="-0.3 pt" tone="success" />
      </Grid>
      <Grid columns={2} gap={3}>
        <Card title="Revenue and costs">
          <LineChart
            series={[
              {
                id: "Revenue",
                data: months.map((month, index) => ({ x: month, y: revenue[index] ?? 0 })),
              },
              {
                id: "Costs",
                data: months.map((month, index) => ({ x: month, y: costs[index] ?? 0 })),
              },
            ]}
            yFormat={money}
            area
            height={220}
          />
        </Card>
        <Card title="Signups by source">
          <PieChart data={sources} donut height={220} valueFormat={(value) => `${value}%`} />
        </Card>
      </Grid>
      <Card title="Monthly margin">
        <BarChart
          data={months.map((month, index) => ({
            month,
            revenue: revenue[index] ?? 0,
            costs: costs[index] ?? 0,
          }))}
          keys={["revenue", "costs"]}
          indexBy="month"
          valueFormat={money}
          height={200}
        />
      </Card>
      <Card title="Quarter goals">
        <Stack gap={3}>
          <Meter label="Annual recurring revenue" value={78} max={100} tone="success" />
          <Meter label="Hiring plan" value={6} max={10} />
          <Meter label="Support backlog" value={82} max={100} tone="warning" />
        </Stack>
      </Card>
      <Card title="By month" padding={0}>
        <Table
          columns={[
            { key: "month", label: "Month" },
            { key: "revenue", label: "Revenue", align: "end" },
            { key: "costs", label: "Costs", align: "end" },
            { key: "margin", label: "Margin", align: "end" },
            { key: "status", label: "Status" },
          ]}
          rows={rows}
        />
      </Card>
      <Text size="sm" tone="secondary">
        Figures are illustrative.
      </Text>
    </Stack>
  );
}
