/** The open tabs of a project: the coordinator is always first and never closes. */

export const COORDINATOR = "coordinator";

interface TabState {
  readonly open: readonly string[];
  readonly active: string;
  readonly history: readonly string[];
  readonly closed: readonly { readonly id: string; readonly index: number }[];
}

export const INITIAL_TABS: TabState = {
  open: [],
  active: COORDINATOR,
  history: [COORDINATOR],
  closed: [],
};

export function activate(state: TabState, id: string): TabState {
  return {
    ...state,
    active: id,
    history: [id, ...state.history.filter((entry) => entry !== id)].slice(0, 10),
  };
}

export function openTab(state: TabState, id: string): TabState {
  const open = state.open.includes(id) ? state.open : [...state.open, id];

  return activate({ ...state, open }, id);
}

export function closeTab(state: TabState, id: string): TabState {
  const index = state.open.findIndex((entry) => entry === id);

  if (index === -1) return state;
  const open = state.open.filter((entry) => entry !== id);
  const history = state.history.filter((entry) => entry !== id);
  const closed = [{ id, index }, ...state.closed].slice(0, 20);

  const next =
    state.active === id
      ? (history.find((entry) => entry === COORDINATOR || open.includes(entry)) ?? COORDINATOR)
      : state.active;

  return { open, active: next, history, closed };
}

export function reopenTab(state: TabState): TabState {
  const [last, ...closed] = state.closed;

  if (last === undefined) return state;
  const open = [...state.open];

  open.splice(Math.min(last.index, open.length), 0, last.id);

  return activate({ ...state, open, closed }, last.id);
}

export function cycleTab(state: TabState, step: 1 | -1): TabState {
  const order = [COORDINATOR, ...state.open];
  const index = order.findIndex((entry) => entry === state.active);
  const next = order[(index + step + order.length) % order.length];

  return next === undefined ? state : activate(state, next);
}
