import { Badge, Callout, Code, Divider, Heading, Stack, Table, Text } from "nyte/canvas";

const findings = [
  {
    file: "src/fold.ts",
    line: 318,
    severity: "danger",
    note: "Snapshot map leaks across sessions.",
  },
  { file: "src/turn.ts", line: 92, severity: "warning", note: "Retry loop has no upper bound." },
  { file: "src/watch.ts", line: 41, severity: "info", note: "Comment is stale after the rename." },
] as const;

export default function Report() {
  return (
    <Stack gap={3}>
      <Heading>Review of #412</Heading>
      <Text tone="secondary">Three findings across the kernel; one blocks merging.</Text>
      <Callout tone="danger" title="Blocking">
        The snapshot cache in <Code>fold.ts</Code> is keyed by the turns array, which is shared
        between sessions after a branch.
      </Callout>
      <Table
        columns={[
          { key: "where", label: "Where" },
          { key: "severity", label: "Severity" },
          { key: "note", label: "Finding" },
        ]}
        rows={findings.map((finding) => ({
          where: <Code>{`${finding.file}:${finding.line}`}</Code>,
          severity: <Badge tone={finding.severity}>{finding.severity}</Badge>,
          note: finding.note,
        }))}
        caption="Findings from the diff, in severity order."
      />
      <Divider />
      <Heading level={3}>Suggested fix</Heading>
      <Code
        block
      >{`const snapshots = new WeakMap<readonly Turn[], Snapshot>();\n\nfunction snapshotOf(turns: readonly Turn[]): Snapshot {\n  return snapshots.get(turns) ?? fresh(turns);\n}`}</Code>
      <Text size="sm" tone="tertiary">
        See the <a href="https://github.com/interfaces-lab/nyte/pull/412">pull request</a>.
      </Text>
    </Stack>
  );
}
