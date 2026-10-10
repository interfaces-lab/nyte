import type { RequestOptions, RunEnd, RunId, StopOutcome } from "@nyte-ai/schema";

/**
 * Returns a handle on one run: stop it, or wait for it to end.
 *
 * **Details**
 *
 * A run's metadata is read from the view: `execution.run`, `turn.run`,
 * `message.status.run`. There is no second read path. Changes a run made are
 * `workspace.changes(run.id)`. There is no restore: snapshots are recorded
 * for diffs, not for putting files back.
 *
 * @category runs
 * @since 0.1.0
 */
export interface Run {
  readonly id: RunId;
  /**
   * Stops this run and nothing else; resolves at the fence.
   *
   * **Details**
   *
   * Stop has two halves; the view only depends on the first.
   *
   * - fence: synchronous in core. The run is marked stopping; every token
   *   that arrives for it from now on is dropped; its live parts flip to
   *   `failed { stopped }`; execution reads stopping. `stop()` resolves here,
   *   and the next `watch()` yield already shows it. Two streams never paint
   *   at once.
   * - cleanup: background. Abort the provider stream, let a running tool see
   *   its signal and return, settle the run as stopped. Only `settled()`
   *   waits for this.
   *
   * **Gotchas**
   *
   * Exact: children and jobs keep working. Stopping a child is
   * `session(child).run(id).stop()`; stopping everything is `session.stop()`.
   *
   * @returns {@link StopOutcome}
   * @authority participant
   */
  stop(): Promise<StopOutcome<RunEnd>>;
  /**
   * Waits for the run to end: a wait, not a state.
   *
   * **When to use**
   *
   * Its one caller is print mode: send, await, print, exit. Interactive
   * clients read the view.
   *
   * @authority participant
   */
  settled(options?: RequestOptions): Promise<RunEnd>;
}
