import { Diff, Sketch } from "./code";
import { CONSTANTS, FUNCTION_GROUPS } from "./data";
import { ISSUE_GROUPS } from "./issues";
import { C, Inline, Src, Table } from "./ui";

export function Constants() {
  return (
    <Table
      head={["Name", "Value", "Governs", "Source"]}
      nowrap={[0, 1, 3]}
      widths={["210px", "110px", "auto", "150px"]}
      rows={CONSTANTS.map((constant) => [
        <C key="0">{constant.name}</C>,
        <C key="1">{constant.value}</C>,
        <Inline key="2" text={constant.governs} />,
        <Src key="3" root={constant.root} path={constant.path} line={constant.line} />,
      ])}
    />
  );
}

export function Functions({ title }: { readonly title: string }) {
  return FUNCTION_GROUPS.flatMap((group) =>
    group.title === title
      ? [
          <div key={group.title}>
            <Table
              head={["Function", "Does", "Source"]}
              nowrap={[0, 2]}
              widths={["180px", "auto", "150px"]}
              rows={group.terms.map((term) => [
                <span key="0" id={`fn-${term.id}`} className="scroll-mt-20">
                  <C>{term.id}</C>
                </span>,
                <Inline key="1" text={term.does} />,
                <Src key="2" path={term.path} line={term.line} />,
              ])}
            />
          </div>,
        ]
      : [],
  );
}

export function OpenIssues({ title }: { readonly title: string }) {
  return ISSUE_GROUPS.flatMap((group) =>
    group.title === title
      ? [
          <div key={group.title}>
            {group.issues.map((issue) => (
              <details key={issue.name} className="kernel-issue">
                <summary>
                  <code>{issue.name}</code>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {issue.path.split("/").at(-1)}:{issue.line}
                  </span>
                </summary>
                <div className="py-3">
                  <p>{issue.why}</p>
                  {issue.fix.kind === "patch" &&
                    issue.fix.patches.map((patch) => <Diff key={patch.path} patch={patch} />)}
                  {issue.fix.kind === "sketch" && (
                    <Sketch title={issue.fix.title} code={issue.fix.code} />
                  )}
                  {issue.fix.kind === "unused" && (
                    <Table
                      head={["Export", "Source"]}
                      rows={issue.fix.exports.map(([name, path, line]) => [
                        <C key="0">{name}</C>,
                        <Src key="1" path={path} line={line} />,
                      ])}
                    />
                  )}
                </div>
              </details>
            ))}
          </div>,
        ]
      : [],
  );
}
