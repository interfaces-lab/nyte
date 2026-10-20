import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { LiveTurn } from "@nyte-ai/app/conversation/live-turn.tsx";
import { StatusMarker } from "@nyte-ai/app/conversation/row-surfaces.tsx";
import { SubagentSessionsProvider } from "@nyte-ai/app/conversation/subagent-sessions.ts";
import type { TranscriptRow } from "@nyte-ai/app/conversation/transcript-rows.ts";
import { ChangesCard, TurnItemView } from "@nyte-ai/app/conversation/turn-view.tsx";
import type { BranchModelPicker } from "@nyte-ai/app/conversation/turn-view.tsx";
import type { ToolCallDensity } from "@nyte-ai/app/preferences/index.ts";
import { TranscriptSkeleton } from "@nyte-ai/app/screens/transcript-skeleton.tsx";
import { conversation } from "@nyte-ai/app/theme/schema.stylex.ts";
import { labModel, modelCatalog } from "../shell/fixtures";
import { CWD, SUBAGENTS, type Specimen } from "./build";
import { SECTIONS } from "./specimens";
import { stage, trail } from "./stage";
import type { Stage } from "./stage";
import { Wiring } from "./wiring";

const DENSITIES = [
  ["compact", "Compact", "Previews the step that's running"],
  ["balanced", "Balanced", "Opens work only while it's in flight"],
  ["detailed", "Detailed", "Keeps finished steps open"],
] as const satisfies readonly (readonly [ToolCallDensity, string, string])[];

type Shown = "all" | ToolCallDensity;

const STAGED = new Map<Specimen, Stage>(
  SECTIONS.flatMap((section) =>
    section.specimens.map((specimen) => [specimen, stage(specimen.scene)]),
  ),
);

const COUNT = STAGED.size;

const SUBAGENT_CONTEXT = { children: SUBAGENTS, open: () => {} };

const BRANCH_MODEL: BranchModelPicker = {
  catalog: modelCatalog,
  model: labModel,
  thinkingLevel: "high",
  fast: false,
};

const editUser = async (): Promise<void> => {};

const openChanges = (): void => {};

function RowView({
  row,
  staged,
  density,
}: {
  readonly row: TranscriptRow;
  readonly staged: Stage;
  readonly density: ToolCallDensity;
}): ReactElement | null {
  const { working, settledWork } = staged;

  switch (row.kind) {
    case "skeleton":
      return <TranscriptSkeleton />;
    case "error":
      return (
        <StatusMarker role="alert" variant="destructive">
          Couldn&rsquo;t load this chat.{" "}
          <Button variant="text" onClick={() => {}}>
            Try Again
          </Button>
        </StatusMarker>
      );
    case "part":
    case "step":
    case "agents":
    case "response":
    case "failure":
      return (
        <TurnItemView
          row={row}
          running={row.kind === "step" && row.trailing && working}
          density={density}
          cwd={CWD}
          onEditUser={editUser}
          branchModel={BRANCH_MODEL}
        />
      );
    case "changes":
      return working ? null : <ChangesCard files={row.files} onOpenChanges={openChanges} />;

    case "prompt":
      return <TurnItemView row={row} running={false} density={density} cwd={CWD} />;
    case "earlier":
      return <StatusMarker>Show Earlier Steps</StatusMarker>;
    case "retry":
      return (
        <StatusMarker role="status" variant="retrying" title={row.message}>
          Retrying…
        </StatusMarker>
      );
    case "live":
      return <LiveTurn working={working} settledWork={settledWork} density={density} cwd={CWD} />;
    default: {
      const _exhaustive: never = row;

      return _exhaustive;
    }
  }
}

function SceneView({
  staged,
  density,
}: {
  readonly staged: Stage;
  readonly density: ToolCallDensity;
}): ReactElement {
  return (
    <div {...props(styles.transcript)}>
      {staged.rows.map((row, index) => (
        <div
          key={row.key}
          {...props(styles.row, !row.leads && styles.rowWithin, index === 0 && styles.rowFirst)}
        >
          <RowView row={row} staged={staged} density={density} />
        </div>
      ))}
    </div>
  );
}

function SpecimenMeta({
  specimen,
  staged,
}: {
  readonly specimen: Specimen;
  readonly staged: Stage;
}): ReactElement {
  const rows = trail(staged);

  return (
    <div {...props(styles.meta)}>
      <h3 {...props(styles.specimenTitle)}>
        <a href={`#${specimen.id}`} {...props(styles.anchor)}>
          {specimen.title}
        </a>
      </h3>
      <code {...props(styles.source)}>{specimen.source}</code>
      {rows.length > 0 && <pre {...props(styles.trail)}>{rows.join("\n")}</pre>}
      <details {...props(styles.details)}>
        <summary {...props(styles.summary)}>SDK data</summary>
        <pre {...props(styles.json)}>{JSON.stringify(specimen.scene, null, 2)}</pre>
      </details>
    </div>
  );
}

function Specimens({ shown }: { readonly shown: Shown }): ReactElement {
  const densities = shown === "all" ? DENSITIES : DENSITIES.filter(([value]) => value === shown);
  const grid = styles.grid(densities.length);

  return (
    <>
      <nav aria-label="Sections" {...props(styles.index)}>
        {SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`} {...props(styles.indexLink)}>
            {section.title}
            <span {...props(styles.indexCount)}>{section.specimens.length}</span>
          </a>
        ))}
      </nav>
      <div role="presentation" {...props(styles.columns, grid)}>
        <span {...props(styles.columnLabel)}>Specimen</span>
        {densities.map(([value, label, detail]) => (
          <span key={value} {...props(styles.columnHead)}>
            <span {...props(styles.columnLabel)}>{label}</span>
            <span {...props(styles.columnDetail)}>{detail}</span>
          </span>
        ))}
      </div>
      {SECTIONS.map((section) => (
        <section
          key={section.id}
          id={section.id}
          aria-labelledby={`${section.id}-title`}
          {...props(styles.section)}
        >
          <header {...props(styles.sectionHeader)}>
            <h2 id={`${section.id}-title`} {...props(styles.sectionTitle)}>
              {section.title}
            </h2>
            <p {...props(styles.sectionDetail)}>{section.detail}</p>
          </header>
          {section.specimens.map((specimen) => {
            const staged = STAGED.get(specimen);

            if (staged === undefined) return null;

            return (
              <article key={specimen.id} id={specimen.id} {...props(styles.specimen, grid)}>
                <SpecimenMeta specimen={specimen} staged={staged} />
                {densities.map(([density, label]) => (
                  <div key={density} aria-label={label} {...props(styles.cell)}>
                    <SceneView staged={staged} density={density} />
                  </div>
                ))}
              </article>
            );
          })}
        </section>
      ))}
    </>
  );
}

export function MessagesPage(): ReactElement {
  const [view, setView] = useState<"specimens" | "wiring">("specimens");
  const [shown, setShown] = useState<Shown>("all");

  return (
    <SubagentSessionsProvider value={SUBAGENT_CONTEXT}>
      <main {...props(styles.page)}>
        <header {...props(styles.header)}>
          <div {...props(styles.heading)}>
            <h1 {...props(styles.title)}>Chat messages</h1>
            <p {...props(styles.detail)}>
              {COUNT} specimens from SDK data, drawn by the app&rsquo;s TurnItemView, LiveTurn and
              row surfaces in each tool call density.
            </p>
          </div>
          <div {...props(styles.actions)}>
            {view === "specimens" && (
              <ToggleGroup
                aria-label="Density"
                value={[shown]}
                onValueChange={(values) => {
                  const next = values.at(-1);

                  if (next === "all") {
                    setShown("all");

                    return;
                  }

                  const density = DENSITIES.find(([value]) => value === next);

                  if (density !== undefined) setShown(density[0]);
                }}
              >
                <Toggle size="sm" value="all">
                  All
                </Toggle>
                {DENSITIES.map(([value, label]) => (
                  <Toggle key={value} size="sm" value={value}>
                    {label}
                  </Toggle>
                ))}
              </ToggleGroup>
            )}
            <ToggleGroup
              aria-label="View"
              value={[view]}
              onValueChange={(values) => {
                const next = values.at(-1);

                if (next === "specimens" || next === "wiring") setView(next);
              }}
            >
              <Toggle size="sm" value="specimens">
                Specimens
              </Toggle>
              <Toggle size="sm" value="wiring">
                Wiring
              </Toggle>
            </ToggleGroup>
          </div>
        </header>
        {view === "specimens" ? <Specimens shown={shown} /> : <Wiring />}
      </main>
    </SubagentSessionsProvider>
  );
}

const META_WIDTH = "minmax(220px, 280px)";

const styles = create({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    boxSizing: "border-box",
    height: "100%",
    overflowY: "auto",
    paddingBlock: "32px 120px",
    paddingInline: 32,
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 16,
  },
  heading: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  title: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    fontWeight: 600,
  },
  detail: {
    margin: 0,
    maxWidth: "72ch",
    color: role.contentTertiary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  actions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  index: { display: "flex", flexWrap: "wrap", gap: 4 },
  indexLink: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 6,
    paddingBlock: 3,
    paddingInline: 8,
    borderRadius: radius.control,
    color: { default: role.contentSecondary, ":hover": role.contentPrimary },
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textDecoration: "none",
  },
  indexCount: {
    color: role.contentTertiary,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  grid: (columns: number) => ({
    gridTemplateColumns: `${META_WIDTH} repeat(${String(columns)}, minmax(0, 1fr))`,
  }),
  columns: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    display: "grid",
    columnGap: 24,
    marginInline: -32,
    paddingBlock: 10,
    paddingInline: 32,
    backgroundColor: role.bgBase,
    boxShadow: `0 1px 0 ${role.borderSecondaryTranslucent}`,
  },
  columnHead: { display: "flex", flexDirection: "column", gap: 0, minWidth: 0 },
  columnLabel: {
    color: role.contentPrimary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontWeight: 600,
  },
  columnDetail: {
    color: role.contentTertiary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
  section: { display: "flex", flexDirection: "column", scrollMarginTop: 72 },
  sectionHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    paddingBlock: "24px 12px",
  },
  sectionTitle: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontWeight: 600,
  },
  sectionDetail: {
    margin: 0,
    maxWidth: "80ch",
    color: role.contentTertiary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  specimen: {
    display: "grid",
    alignItems: "start",
    columnGap: 24,
    paddingBlock: 20,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondaryTranslucent,
    scrollMarginTop: 72,
  },
  meta: {
    position: "sticky",
    top: 72,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  },
  specimenTitle: {
    margin: 0,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontWeight: 600,
  },
  anchor: {
    color: role.contentPrimary,
    textDecoration: { default: "none", ":hover": "underline" },
  },
  source: {
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    overflowWrap: "anywhere",
  },
  trail: {
    margin: 0,
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  details: { minWidth: 0 },
  summary: {
    color: role.contentTertiary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    cursor: "pointer",
    userSelect: "none",
  },
  json: {
    maxHeight: 360,
    margin: 0,
    marginTop: 4,
    padding: 8,
    overflow: "auto",
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
  cell: {
    minWidth: 0,
    overflow: "hidden",
    padding: 4,
    margin: -4,
  },
  transcript: {
    display: "flex",
    flexDirection: "column",
    maxWidth: conversation.measure,
    minWidth: 0,
  },
  row: { minWidth: 0, paddingTop: { default: conversation.turnGap, ":empty": 0 } },
  rowWithin: { paddingTop: { default: conversation.rowGap, ":empty": 0 } },
  rowFirst: { paddingTop: 0 },
});
