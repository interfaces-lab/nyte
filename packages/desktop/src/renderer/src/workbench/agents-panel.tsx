/**
 * The Agents tab: one child session of the current chat at a time. The
 * toolbar picks among the chat's children and can stop the one shown; the
 * body is the child's transcript, live while it runs, over a composer that
 * sends to it.
 */
import { Button as BaseButton } from "@nyte-ai/ui";
import { Toolbar } from "@nyte-ai/ui/toolbar";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { SessionId, SessionInfo, Turn } from "@nyte-ai/protocol";
import { Icon } from "../components/icons.tsx";
import type { IconName } from "../components/icons.tsx";
import { Menu, MenuRadioGroup, MenuRadioItem } from "../components/menu.tsx";
import { Spinner } from "../components/spinner.tsx";
import { focus, IconButton } from "../components/ui.tsx";
import { AGENT_STATE_LABEL, agentState } from "../conversation/agent-status.ts";
import type { AgentState } from "../conversation/agent-status.ts";
import { LiveTurn } from "../conversation/live-turn.tsx";
import { modelDisplayName } from "../conversation/model-picker-state.ts";
import { TurnView } from "../conversation/turn-view.tsx";
import { displayTranscriptParts } from "../conversation/transcript-presentation.ts";
import { rendersInTranscript } from "../conversation/transcript-rows.ts";
import { useSessionLive } from "../live.ts";
import type { LiveSnapshot } from "../live.ts";
import { nyte } from "../nyte.ts";
import {
  keys,
  useCatalog,
  useChildSessions,
  useHostState,
  useSessionSnapshot,
} from "../queries.ts";
import { conversation, workbench } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { agentActions, useSelectedAgent } from "./agents-store.ts";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    height: workbench.headerHeight,
    flexShrink: 0,
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.strokeTertiary,
  },
  picker: {
    appearance: "none",
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 6,
    minWidth: 0,
    maxWidth: "calc(100% - 72px)",
    minHeight: workbench.headerHeight,
    paddingInline: 6,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillGhostHover },
      "[data-popup-open]": t.fillGhostSelected,
    },
    color: t.textPrimary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    cursor: "pointer",
  },
  pickerLabel: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  pickerState: { flexShrink: 0, color: t.textTertiary, fontSize: t.fontSm },
  pickerChevron: { display: "inline-flex", flexShrink: 0, color: t.iconTertiary },
  statusIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    flexShrink: 0,
    lineHeight: 0,
    color: t.iconSecondary,
  },
  spacer: { flex: 1, minWidth: 0 },
  meta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    flexShrink: 0,
    paddingBlock: 6,
    paddingInline: 16,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
  },
  metaSeparator: { color: t.textQuaternary },
  scroll: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" },
  transcript: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 0,
    gap: conversation.turnGap,
    width: "100%",
    paddingInline: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  notice: {
    paddingBlock: 8,
    paddingInline: 16,
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  error: { color: t.textDanger },
  composer: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    paddingBlock: 6,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: t.strokeTertiary,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    borderStyle: "none",
    outline: "none",
    backgroundColor: "transparent",
    color: { default: t.textPrimary, "::placeholder": t.textTertiary },
    fontFamily: "inherit",
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  empty: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    color: t.textSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    textAlign: "center",
  },
});

const EMPTY_TURNS: readonly Turn[] = [];
const EMPTY_LIVE_TOOLS: LiveSnapshot["tools"] = new Map();

interface AgentScrollPosition {
  readonly top: number;
  readonly pinned: boolean;
}

const INITIAL_AGENT_POSITION: AgentScrollPosition = { top: 0, pinned: true };

function createAgentReadingPositions() {
  const positions = new Map<SessionId, AgentScrollPosition>();
  return {
    read: (sessionId: SessionId): AgentScrollPosition =>
      positions.get(sessionId) ?? INITIAL_AGENT_POSITION,
    write: (sessionId: SessionId, position: AgentScrollPosition): void => {
      positions.set(sessionId, position);
    },
  };
}

/** A once-a-second clock while `ticking`; frozen otherwise so finished agents stop re-rendering. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return now;
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${String(minutes)}m ${String(seconds % 60)}s`
    : `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

const STATE_ICON = {
  idle: "clock",
  completed: "checkmark",
  failed: "warning",
  stopped: "circle-x",
} satisfies Readonly<Record<Exclude<AgentState, "working">, IconName>>;

function StatusIcon({ state }: { readonly state: AgentState }): ReactElement {
  return (
    <span
      aria-hidden="true"
      {...stylex.props(styles.statusIcon, state === "failed" && styles.error)}
    >
      {state === "working" ? <Spinner /> : <Icon name={STATE_ICON[state]} size={14} />}
    </span>
  );
}

function agentTitle(agent: SessionInfo): string {
  return agent.name ?? agent.sessionId;
}

function AgentTranscript({
  agent,
  cwd,
  position,
  onPositionChange,
}: {
  readonly agent: SessionInfo;
  readonly cwd: string | undefined;
  readonly position: AgentScrollPosition;
  readonly onPositionChange: (position: AgentScrollPosition) => void;
}): ReactElement {
  const catalog = useCatalog(agent.sessionId);
  const snapshot = useSessionSnapshot(agent.sessionId);
  // A retained cache can predate a hidden interval. The observer opens on a
  // fresh coherent read and watches from it; a failed read keeps the retry
  // affordance, and closing the panel closes the observation.
  const live = useSessionLive(agent.sessionId);
  const turns = (snapshot.data?.transcript ?? EMPTY_TURNS).filter(rendersInTranscript);
  const state = agentState(agent);
  const working = state === "working";
  const startedAt = agent.heads[0]?.run?.startedAt;
  const now = useNow(working);
  const lastTurn = turns.at(-1);
  const settledWork =
    lastTurn?.kind === "turn" && displayTranscriptParts(lastTurn.parts).at(-1)?.kind === "work";
  const model = modelDisplayName(catalog.data, snapshot.data?.config.model);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentPosition = useRef(position);
  const restored = useRef(false);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null || restored.current || snapshot.data === undefined) return;
    const saved = currentPosition.current;
    element.scrollTop = saved.pinned ? element.scrollHeight : saved.top;
    restored.current = true;
  }, [snapshot.data]);
  // A running agent keeps the newest output in view until the reader scrolls up.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null || !currentPosition.current.pinned) return;
    element.scrollTop = element.scrollHeight;
  }, [turns, live]);

  return (
    <>
      <div {...stylex.props(styles.meta)}>
        <span>{model ?? "Model pending"}</span>
        <span aria-hidden="true" {...stylex.props(styles.metaSeparator)}>
          ·
        </span>
        <span>
          {working && startedAt !== undefined
            ? `Working for ${formatElapsed(now - startedAt)}`
            : AGENT_STATE_LABEL[state]}
        </span>
      </div>
      <div
        ref={scrollRef}
        data-nyte-scrollport
        {...stylex.props(styles.scroll)}
        onScroll={(event) => {
          const element = event.currentTarget;
          if (!restored.current) return;
          const next = {
            top: element.scrollTop,
            pinned: element.scrollHeight - element.scrollTop - element.clientHeight < 60,
          };
          currentPosition.current = next;
          onPositionChange(next);
        }}
      >
        <div {...stylex.props(styles.transcript)}>
          {snapshot.isLoading && turns.length === 0 && (
            <div role="status" {...stylex.props(styles.notice)}>
              Loading agent…
            </div>
          )}
          {snapshot.isError && (
            <div role="alert" {...stylex.props(styles.notice, styles.error)}>
              Couldn’t load this agent.{" "}
              <BaseButton
                unstyled
                type="button"
                {...stylex.props(focus.ring)}
                onClick={() => void snapshot.refetch()}
              >
                Try again
              </BaseButton>
            </div>
          )}
          {turns.map((turn, index) => (
            <TurnView
              key={turn.kind === "turn" ? turn.id : `${turn.kind}:${turn.commit}`}
              turn={turn}
              liveTools={working && index === turns.length - 1 ? live.tools : EMPTY_LIVE_TOOLS}
              live={working && index === turns.length - 1 ? live : undefined}
              cwd={cwd}
              running={working && index === turns.length - 1}
            />
          ))}
          <LiveTurn live={live} working={working} settledWork={settledWork} cwd={cwd} />
        </div>
      </div>
    </>
  );
}

type AgentAction =
  | { readonly kind: "stop"; readonly agent: SessionId }
  | { readonly kind: "send"; readonly agent: SessionId; readonly content: string };

function useAgentAction(sessionId: SessionId | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (action: AgentAction) => {
      switch (action.kind) {
        case "stop":
          await nyte.runs.abort({ sessionId: action.agent });
          return;
        case "send":
          await nyte.messages.send({ sessionId: action.agent, content: action.content });
          return;
        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.childSessions(sessionId) }),
  });
}

function AgentComposer({
  agent,
  action,
}: {
  readonly agent: SessionInfo;
  readonly action: ReturnType<typeof useAgentAction>;
}): ReactElement {
  const [draft, setDraft] = useState("");
  return (
    <form
      {...stylex.props(styles.composer)}
      onSubmit={(event) => {
        event.preventDefault();
        const content = draft.trim();
        if (content === "" || action.isPending) return;
        action.mutate(
          { kind: "send", agent: agent.sessionId, content },
          {
            onSuccess: () => setDraft(""),
          },
        );
      }}
    >
      <input
        type="text"
        aria-label={`Message ${agentTitle(agent)}`}
        placeholder={`Message ${agentTitle(agent)}`}
        autoComplete="off"
        value={draft}
        disabled={action.isPending}
        onChange={(event) => setDraft(event.currentTarget.value)}
        {...stylex.props(styles.input)}
      />
      <IconButton
        icon="arrow-up"
        label="Send"
        type="submit"
        disabled={action.isPending || draft.trim() === ""}
      />
    </form>
  );
}

function VisibleAgentsPanel({
  owner,
  sessionId,
  positions,
  action,
}: {
  readonly owner: string;
  readonly sessionId: SessionId | undefined;
  readonly positions: ReturnType<typeof createAgentReadingPositions>;
  readonly action: ReturnType<typeof useAgentAction>;
}): ReactElement {
  const host = useHostState();
  const selectedId = useSelectedAgent(owner);
  const children = useChildSessions(sessionId);
  const agents = (children.data ?? []).toSorted(
    (left, right) => right.lastActivityAt - left.lastActivityAt,
  );
  const selected = agents.find((agent) => agent.sessionId === selectedId) ?? agents[0];
  const selectedState = selected === undefined ? undefined : agentState(selected);

  if (sessionId === undefined || (children.data !== undefined && agents.length === 0)) {
    return (
      <section aria-label="Agents" {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.empty)}>
          <Icon name="robot" size={24} />
          <span>
            {sessionId === undefined
              ? "Open a chat to follow its subagents."
              : "This chat has not delegated to a subagent yet."}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Agents" {...stylex.props(styles.root)}>
      <Toolbar.Root aria-label="Agent actions" {...stylex.props(styles.toolbar)}>
        {selected !== undefined && (
          <Menu
            label="Select agent"
            trigger={
              <BaseButton
                unstyled
                type="button"
                aria-label={`Showing ${agentTitle(selected)}, ${AGENT_STATE_LABEL[agentState(selected)]}`}
                {...stylex.props(styles.picker, focus.ring)}
              >
                <StatusIcon state={agentState(selected)} />
                <span {...stylex.props(styles.pickerLabel)}>{agentTitle(selected)}</span>
                <span {...stylex.props(styles.pickerState)}>
                  {AGENT_STATE_LABEL[agentState(selected)]}
                </span>
                <span {...stylex.props(styles.pickerChevron)}>
                  <Icon name="chevron-down" size={10} />
                </span>
              </BaseButton>
            }
          >
            <MenuRadioGroup
              value={selected.sessionId}
              onValueChange={(value) => {
                const next = agents.find((agent) => agent.sessionId === value);
                if (next !== undefined) agentActions.select(owner, next.sessionId);
              }}
            >
              {agents.map((agent) => (
                <MenuRadioItem
                  key={agent.sessionId}
                  value={agent.sessionId}
                  leading={<StatusIcon state={agentState(agent)} />}
                  meta={
                    <span {...stylex.props(styles.pickerState)}>
                      {AGENT_STATE_LABEL[agentState(agent)]}
                    </span>
                  }
                >
                  {agentTitle(agent)}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </Menu>
        )}
        <span {...stylex.props(styles.spacer)} />
        {selected !== undefined && selectedState === "working" && (
          <IconButton
            icon="square"
            label="Stop agent"
            disabled={action.isPending}
            onClick={() => action.mutate({ kind: "stop", agent: selected.sessionId })}
          />
        )}
      </Toolbar.Root>
      {children.isError && (
        <div role="alert" {...stylex.props(styles.notice, styles.error)}>
          Couldn’t load this chat’s agents.{" "}
          <BaseButton
            unstyled
            type="button"
            {...stylex.props(focus.ring)}
            onClick={() => void children.refetch()}
          >
            Try again
          </BaseButton>
        </div>
      )}
      {action.isError && (
        <div role="alert" {...stylex.props(styles.notice, styles.error)}>
          Couldn’t update this agent. Try again.
        </div>
      )}
      {selected !== undefined && (
        <AgentTranscript
          key={selected.sessionId}
          agent={selected}
          position={positions.read(selected.sessionId)}
          onPositionChange={(position) => positions.write(selected.sessionId, position)}
          cwd={host.data?.workspace?.path}
        />
      )}
      {selected !== undefined && <AgentComposer agent={selected} action={action} />}
    </section>
  );
}

/** Hidden retained tabs keep reading positions, not watches, timers or query observers. */
export function AgentsPanel({
  owner,
  sessionId,
  visible = true,
}: {
  readonly owner: string;
  readonly sessionId: SessionId | undefined;
  readonly visible?: boolean;
}): ReactElement | null {
  const [positions] = useState(createAgentReadingPositions);
  const action = useAgentAction(sessionId);
  return visible ? (
    <VisibleAgentsPanel owner={owner} sessionId={sessionId} positions={positions} action={action} />
  ) : null;
}
