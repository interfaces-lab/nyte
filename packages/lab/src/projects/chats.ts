import type { World } from "./lane.ts";
import { STATUSES } from "./view.ts";
import type { Status, Unit } from "./view.ts";

export interface Ask {
  readonly key: string;
  readonly question: string;
  readonly kind: "gate" | "rebase" | "merge";
  readonly pull: number | null;
}

export interface Chat {
  readonly id: string;
  readonly title: string;
  readonly status: Status | null;
  readonly units: readonly Unit[];
  readonly ask: Ask | null;
  readonly model: string | null;
}

const LISTED = 8;

export function openAsks(world: World): readonly Ask[] {
  const seen = new Set<string>();

  return world.dispatches.flatMap((dispatch) => {
    const decision = dispatch.decision;

    if (decision.kind !== "ask" || world.answered.includes(dispatch.key)) return [];

    if (seen.has(decision.question)) return [];
    seen.add(decision.question);

    return [
      {
        key: dispatch.key,
        question: decision.question,
        kind:
          dispatch.event.kind === "base-moved"
            ? "rebase"
            : dispatch.event.kind === "checks-passed"
              ? "merge"
              : "gate",
        pull: dispatch.event.pull,
      },
    ];
  });
}

function leadingStatus(units: readonly Unit[]): Status | null {
  return (
    STATUSES.find((entry) => units.some((unit) => unit.status === entry.status))?.status ?? null
  );
}

function buildChat(
  id: string,
  title: string,
  model: string | null,
  units: readonly Unit[],
  asks: readonly Ask[],
): Chat {
  const own = units.filter((unit) => unit.kind !== "checkout" && unit.chain[0]?.session === id);

  return {
    id,
    title,
    status: leadingStatus(own),
    units: own,
    ask:
      asks.find((ask) => ask.pull !== null && own.some((unit) => unit.pull?.number === ask.pull)) ??
      null,
    model,
  };
}

export function laneChats(world: World, units: readonly Unit[], lane: string): readonly Chat[] {
  const asks = openAsks(world);

  return world.memberships.flatMap((membership) => {
    if (membership.lane !== lane) return [];
    const designed = world.designed.find((session) => session.id === membership.session);
    const fact = world.sessions.find((session) => session.id === membership.session);

    const chat = buildChat(
      membership.session,
      designed?.title ?? fact?.title ?? membership.session.slice(0, 8),
      designed?.model ?? fact?.models[0] ?? null,
      units,
      asks,
    );

    if (designed !== undefined && (designed.parent !== null || chat.units.length === 0)) return [];

    return [chat];
  });
}

export function folderChats(world: World, units: readonly Unit[], first: string): readonly Chat[] {
  const members = new Set(world.memberships.map((membership) => membership.session));
  const asks = openAsks(world);

  const recent = world.sessions
    .filter(
      (session) =>
        session.parent === null &&
        session.createdAt <= world.at &&
        session.id !== first &&
        !members.has(session.id),
    )
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .slice(0, LISTED);

  const lead = members.has(first) ? [] : world.sessions.filter((session) => session.id === first);

  return [...lead, ...recent].map((session) =>
    buildChat(
      session.id,
      session.title ?? session.id.slice(0, 8),
      session.models[0] ?? null,
      units,
      asks,
    ),
  );
}
