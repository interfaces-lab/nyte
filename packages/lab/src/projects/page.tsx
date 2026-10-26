import { props } from "@stylexjs/stylex";
import { DialRoot } from "dialkit";
import { useState, type ReactElement } from "react";
import type { WindowTabItem } from "@nyte-ai/app/tabs/window-tab-strip.tsx";
import { Icon } from "@nyte-ai/ui/icon";
import { useDisplayMode } from "../shell/display-mode";
import { folderChats, laneChats, openAsks, stackable } from "./chats.ts";
import type { Ask } from "./chats.ts";
import { EXPORT_COMMAND, useEvidence } from "./data.ts";
import { useProjectDials } from "./dials.ts";
import type { Evidence } from "./evidence.ts";
import { styles } from "./page.stylex";
import { Journey } from "./journey.tsx";
import { ProjectsSidebar, StatusGlyph } from "./sidebar.tsx";
import { ChatTab, LaneTab } from "./tab-content.tsx";
import type { Answer, Next } from "./tab-content.tsx";
import { Titlebar } from "./titlebar.tsx";
import { deriveView } from "./view.ts";
import { DRAGGED_SESSION, scenarios } from "./world.ts";
import type { Step } from "./world.ts";

const LANE = "lane";

interface Shell {
  readonly step: number;
  readonly tabs: readonly string[];
  readonly active: string;
  readonly sidebar: boolean;
}

const START: Shell = { step: 0, tabs: [LANE], active: LANE, sidebar: true };

function Missing({
  pending,
  error,
}: {
  readonly pending: boolean;
  readonly error: string | undefined;
}): ReactElement {
  return (
    <div {...props(styles.shell)}>
      <div {...props(styles.empty)}>
        <h1 {...props(styles.paneTitle)}>{pending ? "Reading the export…" : "No export yet"}</h1>
        {!pending && (
          <>
            <p {...props(styles.lead)}>
              {error ??
                "The page reads packages/lab/research_notes/projects/export, which the export writes."}
            </p>
            <pre {...props(styles.prompt)}>{EXPORT_COMMAND}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function happened(step: Step, title: string, pulls: number, runs: number): string | null {
  switch (step.id) {
    case "drag":
      return `Polish took “${title}”. A babysitter now watches each of its ${String(pulls)} pull requests.`;
    case "tick":
      return "None of the failures are the pull requests' own. Main's formatting is broken, so Polish fixes main once, with one command.";
    case "answered":
      return "Changesets is off the gate. The fix to main is running CI.";
    case "merged":
      return "The fix is in main.";
    case "rebased":
      return "Rebased onto main, with the old heads kept. #19 is running CI.";
    case "ready":
      return `#19 passed and is ready to merge. ${runs === 0 ? "No model ran." : `${String(runs)} model runs.`}`;
    default:
      return null;
  }
}

function Board({ evidence }: { readonly evidence: Evidence }): ReactElement {
  const [shell, setShell] = useState(START);
  const dials = useProjectDials();
  useDisplayMode(dials.scheme);
  const all = scenarios(evidence, dials.knobs);
  const journey = all.find((scenario) => scenario.id === "drag");
  const step = journey?.steps[Math.min(shell.step, journey.steps.length - 1)];

  if (journey === undefined || step === undefined)
    return <Missing pending={false} error="This export has no drag journey to show." />;
  const lane = step.world.lanes[0];

  if (lane === undefined)
    return <Missing pending={false} error="This export has no stack to show." />;
  const units = deriveView(step.world, evidence.checkout.folder);
  const members = laneChats(step.world, units, lane.id);
  const loose = folderChats(step.world, units, DRAGGED_SESSION);
  const asks = openAsks(step.world);
  const shown = journey.steps.slice(0, shell.step + 1);
  const prompts = shown.flatMap((entry) => entry.prompts);
  const runs = shown.reduce((sum, entry) => sum + (entry.plan?.runs ?? 0), 0);
  const dragged = evidence.sessions.find((session) => session.id === DRAGGED_SESSION);
  const title = dragged?.title ?? DRAGGED_SESSION.slice(0, 8);
  const pulls = dragged?.opened.length ?? 0;
  const chats = [...members, ...loose];
  const movable = loose.filter(stackable).map((candidate) => candidate.id);
  const tabs = shell.tabs.filter((id) => id === LANE || chats.some((chat) => chat.id === id));
  const active = tabs.includes(shell.active) ? shell.active : LANE;
  const chat = chats.find((candidate) => candidate.id === active);

  const go = (): void =>
    setShell((current) => ({
      ...current,
      step: Math.min(current.step + 1, journey.steps.length - 1),
    }));

  const open = (id: string): void =>
    setShell((current) => ({
      ...current,
      tabs: current.tabs.includes(id) ? current.tabs : [...current.tabs, id],
      active: id,
    }));

  const move = (id: string): void => {
    if (id === DRAGGED_SESSION && step.id === "before") go();
  };

  const answer = (ask: Ask): Answer | null => {
    if (ask.kind === "gate") return { label: "Stop Checking Changesets", run: go };

    if (ask.kind === "rebase")
      return { label: `Rebase ${String(pulls)} ${pulls === 1 ? "Branch" : "Branches"}`, run: go };

    return null;
  };

  const next: Next | null =
    step.id === "drag"
      ? { text: "Next check in 1 minute.", label: "Check Now", run: go }
      : step.id === "answered"
        ? { text: "CI on the fix takes about 20 minutes.", label: "Skip Ahead", run: go }
        : step.id === "rebased"
          ? { text: "CI on #19 takes about 20 minutes.", label: "Skip Ahead", run: go }
          : step.id === "ready"
            ? { text: "Merging stays yours.", label: "Start Over", run: () => setShell(START) }
            : null;

  const items: readonly WindowTabItem[] = tabs.map((id) => {
    const found = chats.find((candidate) => candidate.id === id);

    return {
      id,
      title: found?.title ?? lane.name,
      tooltip: found?.title ?? `${lane.name} stack`,
      glyph:
        found === undefined ? (
          <Icon name="layers" size={14} />
        ) : found.status === null ? undefined : (
          <StatusGlyph status={found.status} />
        ),
      unread: false,
      split: undefined,
    };
  });

  const said = happened(step, title, pulls, runs);

  return (
    <div {...props(styles.shell)}>
      <Titlebar
        tabs={items}
        active={active}
        sidebar={shell.sidebar}
        onSidebar={() => setShell((current) => ({ ...current, sidebar: !current.sidebar }))}
        onActivate={(id) => setShell((current) => ({ ...current, active: id }))}
        onClose={(ids) =>
          setShell((current) => {
            const kept = current.tabs.filter((id) => !ids.includes(id));
            const left = kept.length === 0 ? [LANE] : kept;

            return {
              ...current,
              tabs: left,
              active: left.includes(current.active) ? current.active : (left.at(-1) ?? LANE),
            };
          })
        }
        onReorder={(ids) => setShell((current) => ({ ...current, tabs: ids }))}
        onNewTab={() => open(LANE)}
      />
      <div {...props(styles.stage)}>
        {shell.sidebar && (
          <div {...props(styles.seat)}>
            <ProjectsSidebar
              lane={{
                name: lane.name,
                questions: asks.filter((ask) => ask.pull === null).length,
                chats: members,
              }}
              folder={{ name: "nyte", path: evidence.checkout.folder, chats: loose }}
              selected={active}
              movable={movable}
              onOpen={open}
              onOpenLane={() => open(LANE)}
              onMove={move}
            />
          </div>
        )}
        <main {...props(styles.card, !shell.sidebar && styles.cardSidebarHidden)}>
          {chat === undefined ? (
            <LaneTab
              lane={lane}
              chats={members}
              asks={asks}
              answer={answer}
              happened={said}
              next={next}
              empty={`Nothing in ${lane.name} yet. Drag “${title}” from Workspaces onto ${lane.name}.`}
              prompts={prompts}
              onOpen={open}
            />
          ) : (
            <ChatTab
              key={chat.id}
              chat={chat}
              inLane={members.some((member) => member.id === chat.id)}
              answer={answer}
              happened={said}
              next={next}
              move={movable.includes(chat.id) ? () => move(chat.id) : undefined}
              prompts={prompts.filter((prompt) => prompt.to.includes(chat.id))}
            />
          )}
        </main>
        {dials.journey && (
          <Journey
            played={journey}
            others={all.filter((scenario) => scenario.id !== journey.id)}
            at={shell.step}
            onStep={(index) => setShell((current) => ({ ...current, step: index }))}
          />
        )}
      </div>
      <DialRoot position="bottom-right" defaultOpen={false} />
    </div>
  );
}

export function ProjectsPage(): ReactElement {
  const evidence = useEvidence();

  if (evidence.data === undefined)
    return <Missing pending={evidence.isPending} error={evidence.error?.message} />;

  return <Board evidence={evidence.data} />;
}
