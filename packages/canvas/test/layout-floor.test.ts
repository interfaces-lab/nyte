import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromiumFound, openShellPreview } from "./preview-shell.ts";
import type { ShellPreview } from "./preview-shell.ts";

const kit = `import { BarChart, Card, Heading, LineChart, Stack, Text } from "nyte/canvas";`;

const reproduction = `${kit}
const data = [
  { month: "Jan", signups: 120, churn: 30 }, { month: "Feb", signups: 180, churn: 42 },
  { month: "Mar", signups: 240, churn: 38 }, { month: "Apr", signups: 210, churn: 55 },
];
export default function Report() {
  return (
    <Stack gap={0}>
      <Heading level={2}>Growth this quarter</Heading>
      <Text tone="secondary">Signups against churn, by month</Text>
      <Card padding={0}>
        <Text weight="semibold">Signups</Text>
        <BarChart data={data} keys={["signups", "churn"]} indexBy="month" mode="grouped" />
      </Card>
      <Card title="Trend">
        <LineChart series={[{ id: "signups", data: data.map((row) => ({ x: row.month, y: row.signups })) }]} />
      </Card>
    </Stack>
  );
}`;

const panel = `function Panel() {
  return <Card><Text>Inside</Text></Card>;
}`;

const cases = [
  { name: "the reproduction, after the kit's floor", rules: [], at: null, source: reproduction },
  {
    name: "a heading over a Card the kit can't see",
    rules: ["lead"],
    at: "main.tsx:3",
    source: `${kit}\n${panel}\nexport default () => <Stack gap={0}><Heading>Title</Heading><Panel /></Stack>;`,
  },
  {
    name: "two hidden Cards that touch",
    rules: ["gap"],
    at: "main.tsx:3",
    source: `${kit}\n${panel}\nexport default () => <Stack gap={0}><Panel /><Panel /></Stack>;`,
  },
  {
    name: "text on the edge of a painted box",
    rules: ["inset"],
    at: "main.tsx:2",
    source: `export default () => (
  <div style={{ background: "#e5e5e5", padding: "8px 0" }}><span>Edge</span></div>
);`,
  },
  {
    name: "text drawn over text",
    rules: ["overlap"],
    at: "main.tsx:3",
    source: `export default () => (
  <div style={{ position: "relative", height: 40 }}>
    <span style={{ position: "absolute", left: 0 }}>Alpha beta</span>
    <span style={{ position: "absolute", left: 12 }}>Gamma delta</span>
  </div>
);`,
  },
  {
    name: "a label cut off by its box",
    rules: ["clip"],
    at: "main.tsx:2",
    source: `export default () => (
  <div style={{ width: 80, overflow: "hidden", whiteSpace: "nowrap" }}>A label far too long for its box</div>
);`,
  },
  {
    name: "a block wider than the canvas",
    rules: ["overflow"],
    at: "main.tsx:2",
    source: `export default () => (
  <div style={{ width: 1200 }}>Wide</div>
);`,
  },
];

describe.skipIf(!chromiumFound)("the layout floor in a real Chromium", () => {
  const opened: { shell?: ShellPreview } = {};

  beforeAll(async () => {
    opened.shell = await openShellPreview();
  }, 60_000);

  afterAll(async () => {
    await opened.shell?.close();
  });

  it.each(cases)("$name", { timeout: 30_000 }, async (row) => {
    const shell = opened.shell;

    if (shell === undefined) throw new Error("The shell did not open.");
    const previewed = await shell.preview(row.source);
    const findings = previewed.report.findings;

    expect(previewed.report.errors).toEqual([]);
    expect(
      [...new Set(findings.map((finding) => finding.rule))],
      JSON.stringify(findings, null, 2),
    ).toEqual(row.rules);

    for (const finding of findings) {
      expect(finding.at).toBe(row.at);
      expect(finding.widths.length).toBeGreaterThan(0);
      expect(finding.message).toMatch(/\d+ px/u);
      expect(finding.fix).not.toBe("");
    }
  });
});
