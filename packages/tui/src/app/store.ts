import { batch, createMemo, createRoot, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { Runner } from "../effects/runner.ts";
import type { RunnerContext } from "../effects/scope.ts";
import type { Effect } from "../model/effect.ts";
import type { Msg } from "../model/msg.ts";
import { reduce } from "../model/reduce.ts";
import { deriveScreen } from "../model/screen.ts";
import type { ScreenModel } from "../model/screen.ts";
import type { State } from "../model/state.ts";

export interface Store {
  readonly state: Accessor<State>;
  readonly screen: Accessor<ScreenModel>;
  readonly runner: Runner;
  readonly dispatch: (msg: Msg) => void;
  settled(): Promise<void>;
  dispose(): void;
}

interface StoreOptions {
  readonly initial: State;
  readonly now: () => number;
  readonly runner: (context: Omit<RunnerContext, "ports" | "signal">) => Runner;
  readonly report: (origin: "reducer", error: unknown) => void;
}

export function createStore(options: StoreOptions): Store {
  let current = options.initial;
  const queue: Msg[] = [];
  const effects: Effect[] = [];
  let draining = false;

  return createRoot((dispose) => {
    const [state, setState] = createSignal(current);
    let previous: ScreenModel | null = null;

    const screen = createMemo(() => {
      const next = state();

      try {
        previous = deriveScreen(next, previous);
      } catch (error) {
        if (previous === null) throw error;
        queueMicrotask(() => options.report("reducer", error));
      }

      return previous;
    });

    const step = (msg: Msg): void => {
      try {
        const result = reduce(current, msg, options.now());
        current = result.state;
        effects.push(...result.effects);
      } catch (error) {
        if (msg.kind !== "failure") options.report("reducer", error);
      }
    };

    const dispatch = (msg: Msg): void => {
      queue.push(msg);

      if (draining) return;
      draining = true;

      try {
        while (queue.length > 0) {
          batch(() => {
            for (let next = queue.shift(); next !== undefined; next = queue.shift()) step(next);
            setState(() => current);
          });

          for (const effect of effects.splice(0)) runner.run(effect);
        }
      } finally {
        draining = false;
      }
    };

    const runner = options.runner({ dispatch, read: () => current });

    return {
      state,
      screen,
      runner,
      dispatch,
      settled: () => runner.settled(),
      dispose,
    };
  });
}
