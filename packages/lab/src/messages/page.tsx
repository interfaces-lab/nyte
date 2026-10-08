/**
 * Every row the chat transcript draws, in every tool call density. Each
 * specimen is SDK data (a slice of `SessionSnapshot` plus the client's live
 * overlay), staged the way `screens/thread.tsx` stages a session and drawn by
 * the app's own row surfaces, the way `Timeline` draws them.
 */
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { LiveTurn, liveTurnStyles } from "@nyte-ai/app/conversation/live-turn.tsx";
import { StatusMarker } from "@nyte-ai/app/conversation/row-surfaces.tsx";
import { SubagentSessionsProvider } from "@nyte-ai/app/conversation/subagent-sessions.ts";
import type { TranscriptRow } from "@nyte-ai/app/conversation/transcript-rows.ts";
import { TurnView, UserMessageView } from "@nyte-ai/app/conversation/turn-view.tsx";
import type { BranchModelPicker } from "@nyte-ai/app/conversation/turn-view.tsx";
import type { LiveToolProgress } from "@nyte-ai/app/live-fold.ts";
import type { ToolCallDensity } from "@nyte-ai/app/preferences/index.ts";
import { keys, queryClient } from "@nyte-ai/app/queries.ts";
import { TranscriptSkeleton } from "@nyte-ai/app/screens/transcript-skeleton.tsx";
import { conversation } from "@nyte-ai/app/theme/schema.stylex.ts";
import { labModel, modelCatalog } from "../shell/fixtures";
import { CWD, SECTIONS, SUBAGENTS, UNSTARTED } from "./specimens";
import type { Scene, Specimen } from "./specimens";
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

const NO_LIVE_TOOLS: ReadonlyMap<string, LiveToolProgress> = new Map();

const SUBAGENT_CONTEXT = { children: SUBAGENTS, open: () => {} };

const BRANCH_MODEL: BranchModelPicker = {
  catalog: modelCatalog,
  model: labModel,
  thinkingLevel: "high",
  fast: false,
};

// The child that never started reads as absent, which is what `useSession` answers for it.
queryClient.setQueryData(keys.session(UNSTARTED), null);

const editUser = async (): Promise<void> => {};

const openChanges = (): void => {};

/** `Timeline`'s row switch, fed a staged scene instead of the session's live store. */
function RowView({
  row,
  staged,
  density,
}: {
  readonly row: TranscriptRow;
  readonly staged: Stage;
  readonly density: ToolCallDensity;
}): ReactElement | null {
  const { live, working, settledWork } = staged;

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
    case "turn": {
      const trailing = row.trailing && working;

      return (
        <TurnView
          turn={row.turn}
          continuations={row.continuations}
          density={density}
          liveTools={trailing ? live.tools : NO_LIVE_TOOLS}
          live={trailing ? live : undefined}
          cwd={CWD}
          onEditUser={editUser}
          branchModel={BRANCH_MODEL}
          onOpenChanges={openChanges}
          running={trailing}
        />
      );
    }

    case "landing":
      return (
        <div
          title={row.pending ? "Lands at the next response" : undefined}
          {...props(liveTurnStyles.root, row.pending && liveTurnStyles.pending)}
        >
          <UserMessageView content={row.content} />
        </div>
      );
    case "retry":
      return (
        <StatusMarker role="status" variant="retrying" title={row.message}>
          Retrying…
        </StatusMarker>
      );
    case "live":
      return (
        <LiveTurn
          live={live}
          working={working}
          settledWork={settledWork}
          density={density}
          cwd={CWD}
        />
      );
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
      {staged.rows.map((row) => (
        <RowView key={row.messageId} row={row} staged={staged} density={density} />
      ))}
    </div>
  );
}

/** Maps print as objects so a LiveSnapshot shows what it holds. */
function json(value: Scene | Stage["live"]): string {
  return JSON.stringify(
    value,
    (_key, entry) => (entry instanceof Map ? Object.fromEntries(entry) : entry),
    2,
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
  const live = specimen.scene.run !== undefined;

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
        <pre {...props(styles.json)}>{json(specimen.scene)}</pre>
      </details>
      {live && (
        <details {...props(styles.details)}>
          <summary {...props(styles.summary)}>As the app reshapes it (LiveSnapshot)</summary>
          <pre {...props(styles.json)}>{json(staged.live)}</pre>
        </details>
      )}
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
              {COUNT} specimens from SDK data, drawn by the app&rsquo;s TurnView, LiveTurn and row
              surfaces in each tool call density.
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
    minHeight: "100vh",
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
  // A scroll container, so a prompt's sticky row stays inside its own cell.
  cell: {
    minWidth: 0,
    overflow: "hidden",
    padding: 4,
    margin: -4,
  },
  transcript: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.turnGap,
    maxWidth: conversation.measure,
    minWidth: 0,
  },
});
