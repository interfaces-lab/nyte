/**
 * Ordered configuration intent for one followed session.
 *
 * A known cycle changes selection at once; discovery reserves its input
 * order before yielding. Keep the local selection until version-valid SDK
 * selected inputs include the acknowledged config. Pending selections stay
 * visible while metadata catches up; failures restore the last acknowledged
 * choice or, once reconciled, the SDK selection.
 *
 * Dispatch is one ordered queue of configuration intents and submission
 * slots. One configure is in flight at a time. Consecutive intents coalesce
 * into the newest of their run; a slot ends a run, so the configuration a
 * message was pressed under is dispatched exactly as captured, and later
 * intents wait until that message is admitted or abandoned. This orders
 * admission: the config commit is queued before the message and later config
 * commits after it. Which run a message finally executes under across core's
 * lanes is core's landing policy, not a promise made here.
 */
import type { Api, Model } from "@nyte-ai/ai";
import type { ConfigureOutcome, ThinkingLevel } from "@nyte-ai/core";

/** What the next run would use: a model and a thinking level. */
export interface RunChoice {
  readonly model: Model<Api>;
  readonly thinkingLevel: ThinkingLevel;
}

/** The fields one request changes; unspecified fields keep the selected value. */
export interface ConfigPatch {
  readonly model?: Model<Api>;
  readonly thinkingLevel?: ThinkingLevel;
}

type ConfigureResult =
  | { readonly kind: "acknowledged" }
  /** No dispatch was needed, or a newer request carried this change instead. */
  | { readonly kind: "superseded" }
  | { readonly kind: "failed"; readonly message: string };

/** A message's place in the order, reserved when Enter is pressed. */
export interface SubmissionSlot {
  /**
   * Settles once every configuration selected before the reservation has been
   * acknowledged or failed, with the result of the newest one; nothing when
   * none was outstanding.
   */
  readonly configured: Promise<ConfigureResult | undefined>;
  /** The message was admitted or abandoned: configuration selected after it may go. */
  release(): void;
}

interface SessionConfiguratorOptions {
  readonly configure: (patch: ConfigPatch) => Promise<ConfigureOutcome>;
  /** SDK selected session inputs, including acknowledged config that has not landed yet. */
  readonly readSelected: () => RunChoice;
  /** The selected configuration moved; repaint from it. */
  readonly onChange: (selected: RunChoice) => void;
  /** Core queued the commit; `patch` names the fields the user chose. */
  readonly onAcknowledged: (choice: RunChoice, patch: ConfigPatch) => void;
}

interface Intent {
  readonly kind: "config";
  readonly choice: RunChoice;
  patch: ConfigPatch;
  result: ConfigureResult | undefined;
  readonly settled: PromiseWithResolvers<ConfigureResult>;
}

interface Slot {
  readonly kind: "slot";
  /** The newest intent selected before the reservation. */
  readonly awaiting: Intent | undefined;
  readonly configured: PromiseWithResolvers<ConfigureResult | undefined>;
  reached: boolean;
  released: boolean;
}

interface Preparation {
  outcome:
    | { readonly kind: "pending" }
    | { readonly kind: "ready" }
    | Extract<ConfigureResult, { kind: "failed" }>;
}

function sameChoice(left: RunChoice, right: RunChoice): boolean {
  return (
    left.model.provider === right.model.provider &&
    left.model.id === right.model.id &&
    left.thinkingLevel === right.thinkingLevel
  );
}

function failureMessage(outcome: Exclude<ConfigureOutcome, { kind: "queued" }>, choice: RunChoice) {
  switch (outcome.kind) {
    case "unknown_model":
      return `Unknown model: ${choice.model.provider}/${choice.model.id}`;
    case "unknown_agent":
      return "Unknown agent";
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

function isIntent(entry: Intent | Slot): entry is Intent {
  return entry.kind === "config";
}

export class SessionConfigurator {
  private readonly options: SessionConfiguratorOptions;
  private selectedChoice: RunChoice | undefined;
  /** Retained until a selected SDK read started after acknowledgement arrives. */
  private acknowledgedChoice: RunChoice | undefined;
  private readonly queue: (Intent | Slot)[] = [];
  private inFlight: Intent | undefined;
  /** Fields a failed intent established nothing for; the next dispatch carries them. */
  private carried: ConfigPatch = {};
  private disposed = false;
  private revision = 0;
  private preparing = false;
  private readonly preparations: (() => void | Promise<void>)[] = [];
  private latestPreparation: Preparation | undefined;

  constructor(options: SessionConfiguratorOptions) {
    this.options = options;
  }

  /** What the user selected, or core's projection when nothing is outstanding. */
  get selected(): RunChoice {
    return this.selectedChoice ?? this.options.readSelected();
  }

  /** A configuration request has not been acknowledged or failed yet. */
  get pending(): boolean {
    return this.preparingSelection || this.inFlight !== undefined || this.queue.some(isIntent);
  }

  /** Discovery is still preparing a selection earlier than the next input. */
  get preparingSelection(): boolean {
    return this.preparing || this.preparations.length > 0;
  }

  get version(): number {
    return this.revision;
  }

  /** A selected SDK projection includes queued config, so it needs no landing evidence. */
  observeSelected(version: number): void {
    if (version !== this.revision) return;
    this.acknowledgedChoice = undefined;
    this.reconcile();
  }

  request(patch: ConfigPatch): Promise<ConfigureResult> {
    return this.prepareSelection(() => patch);
  }

  /** Register discovery before it yields; known selections still update synchronously. */
  prepareSelection(
    prepare: (selected: RunChoice) => ConfigPatch | undefined | Promise<ConfigPatch | undefined>,
  ): Promise<ConfigureResult> {
    this.revision += 1;
    const preparation: Preparation = { outcome: { kind: "pending" } };
    this.latestPreparation = preparation;
    const settled = Promise.withResolvers<ConfigureResult>();
    const apply = (patch: ConfigPatch | undefined): void => {
      preparation.outcome = { kind: "ready" };
      settled.resolve(patch === undefined ? { kind: "superseded" } : this.requestPrepared(patch));
    };
    const fail = (cause: unknown): void => {
      const result: ConfigureResult = {
        kind: "failed",
        message: cause instanceof Error ? cause.message : String(cause),
      };
      preparation.outcome = result;
      settled.resolve(result);
    };
    this.preparations.push(() => {
      try {
        const patch = prepare(this.selected);
        if (patch instanceof Promise) return patch.then(apply, fail);
        apply(patch);
      } catch (cause) {
        fail(cause);
      }
      return undefined;
    });
    this.prepareNext();
    return settled.promise;
  }

  private prepareNext(): void {
    if (this.preparing) return;
    while (this.preparations.length > 0) {
      const work = this.preparations.shift();
      const pending = work?.();
      if (pending instanceof Promise) {
        this.preparing = true;
        void pending.finally(() => {
          this.preparing = false;
          this.prepareNext();
        });
        return;
      }
    }
    this.reconcile();
  }

  private requestPrepared(patch: ConfigPatch): Promise<ConfigureResult> {
    const base = this.selected;
    const choice: RunChoice = {
      model: patch.model ?? base.model,
      thinkingLevel: patch.thinkingLevel ?? base.thinkingLevel,
    };
    const intent: Intent = {
      kind: "config",
      choice,
      patch,
      result: undefined,
      settled: Promise.withResolvers<ConfigureResult>(),
    };
    this.selectedChoice = choice;
    this.queue.push(intent);
    if (!this.disposed) this.options.onChange(choice);
    this.pump();
    return intent.settled.promise;
  }

  /** Reserve the next place in the order for a message, before anything yields. */
  reserveSubmission(): SubmissionSlot {
    // Only submissions registered during this discovery inherit its failure.
    const preparation =
      this.latestPreparation?.outcome.kind === "pending" ? this.latestPreparation : undefined;
    const configured = Promise.withResolvers<ConfigureResult | undefined>();
    let reserved: SubmissionSlot | undefined;
    let released = false;
    this.preparations.push(() => {
      if (released) return;
      reserved = this.reservePreparedSubmission();
      const failure = preparation?.outcome.kind === "failed" ? preparation.outcome : undefined;
      configured.resolve(reserved.configured.then((result) => failure ?? result));
    });
    this.prepareNext();
    return {
      configured: configured.promise,
      release: () => {
        released = true;
        if (reserved === undefined) configured.resolve(undefined);
        else reserved.release();
      },
    };
  }

  private reservePreparedSubmission(): SubmissionSlot {
    const slot: Slot = {
      kind: "slot",
      awaiting: this.queue.findLast(isIntent) ?? this.inFlight,
      configured: Promise.withResolvers<ConfigureResult | undefined>(),
      reached: false,
      released: false,
    };
    this.queue.push(slot);
    this.pump();
    return {
      configured: slot.configured.promise,
      release: () => {
        if (slot.released) return;
        slot.released = true;
        const index = this.queue.indexOf(slot);
        if (index !== -1) this.queue.splice(index, 1);
        // Released before its turn came: nothing was waited for.
        if (!slot.reached) slot.configured.resolve(undefined);
        this.pump();
      },
    };
  }

  /**
   * The shell stopped following this session. Outstanding work still settles
   * by its real outcome so a reserved slot tells the truth; only the callbacks
   * that paint or persist fall silent.
   */
  dispose(): void {
    this.disposed = true;
  }

  private reconcile(): void {
    if (this.acknowledgedChoice !== undefined) return;
    if (this.pending) return;
    const previous = this.selected;
    this.selectedChoice = undefined;
    if (!this.disposed && !sameChoice(previous, this.selected))
      this.options.onChange(this.selected);
  }

  private pump(): void {
    if (this.inFlight !== undefined) return;
    const head = this.queue[0];
    if (head === undefined) return;
    if (head.kind === "slot") {
      // Everything selected before the message has settled; the slot now
      // holds later configuration until the message is admitted.
      if (!head.reached) {
        head.reached = true;
        head.configured.resolve(head.awaiting?.result);
      }
      return;
    }
    const run: Intent[] = [];
    for (const entry of this.queue) {
      if (!isIntent(entry)) break;
      run.push(entry);
    }
    this.queue.splice(0, run.length);
    const next = run.pop();
    if (next === undefined) return;
    // The newest choice already includes every earlier change; the dispatch
    // names each field any of them touched, plus what a failed one left behind.
    const touched = [...run, next];
    const carriesModel =
      this.carried.model !== undefined ||
      touched.some((intent) => intent.patch.model !== undefined);
    const carriesLevel =
      this.carried.thinkingLevel !== undefined ||
      touched.some((intent) => intent.patch.thinkingLevel !== undefined);
    this.carried = {};
    next.patch = {
      ...(carriesModel ? { model: next.choice.model } : {}),
      ...(carriesLevel ? { thinkingLevel: next.choice.thinkingLevel } : {}),
    };
    for (const intent of run) this.settle(intent, { kind: "superseded" });
    this.inFlight = next;
    void this.dispatch(next);
  }

  private async dispatch(intent: Intent): Promise<void> {
    let result: ConfigureResult;
    try {
      const outcome = await this.options.configure(intent.patch);
      if (outcome.kind === "queued") {
        result = { kind: "acknowledged" };
      } else {
        result = { kind: "failed", message: failureMessage(outcome, intent.choice) };
      }
    } catch (cause) {
      result = { kind: "failed", message: cause instanceof Error ? cause.message : String(cause) };
    }
    this.inFlight = undefined;
    if (result.kind === "acknowledged") {
      this.revision += 1;
      this.acknowledgedChoice = intent.choice;
      if (!this.disposed) this.options.onAcknowledged(intent.choice, intent.patch);
    } else if (this.queue.some(isIntent)) {
      // A newer intent was computed on top of this one; it must establish these fields itself.
      this.carried = { ...this.carried, ...intent.patch };
    } else {
      // Nothing newer was asked for, so the failed choice stops being shown.
      this.selectedChoice = this.acknowledgedChoice;
      if (!this.disposed) this.options.onChange(this.selected);
    }
    this.reconcile();
    this.settle(intent, result);
    this.pump();
  }

  private settle(intent: Intent, result: ConfigureResult): void {
    intent.result = result;
    intent.settled.resolve(result);
  }
}
