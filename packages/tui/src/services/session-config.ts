import type { ConfigureOutcome, ModelRef, Thinking } from "@nyte-ai/sdk";

export interface RunChoice {
  readonly model: ModelRef;
  readonly thinkingLevel: Thinking;
}

export interface ConfigPatch {
  readonly model?: ModelRef;
  readonly thinkingLevel?: Thinking;
}

type ConfigureResult =
  | { readonly kind: "acknowledged" }
  | { readonly kind: "superseded" }
  | { readonly kind: "failed"; readonly message: string };

export interface SubmissionSlot {
  readonly configured: Promise<ConfigureResult | undefined>;
  release(): void;
}

interface SessionConfiguratorOptions {
  readonly configure: (patch: ConfigPatch) => Promise<ConfigureOutcome>;
  readonly readSelected: () => RunChoice;
  readonly onChange: (selected: RunChoice) => void;
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

function failureMessage(
  outcome: Exclude<ConfigureOutcome, { kind: "configured" }>,
  choice: RunChoice,
): string {
  switch (outcome.kind) {
    case "unknown-model":
      return `Unknown model: ${choice.model.provider}/${choice.model.id}`;
    case "unknown-agent":
      return `Unknown agent: ${outcome.agent}`;
    case "invalid":
      return outcome.issues.map((issue) => issue.message).join("; ") || "Invalid configuration";
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
  private acknowledgedChoice: RunChoice | undefined;
  private readonly queue: (Intent | Slot)[] = [];
  private inFlight: Intent | undefined;
  private carried: ConfigPatch = {};
  private disposed = false;
  private preparing = false;
  private readonly preparations: (() => void | Promise<void>)[] = [];
  private latestPreparation: Preparation | undefined;

  constructor(options: SessionConfiguratorOptions) {
    this.options = options;
  }

  get selected(): RunChoice {
    return this.selectedChoice ?? this.options.readSelected();
  }

  get pending(): boolean {
    return this.preparingSelection || this.inFlight !== undefined || this.queue.some(isIntent);
  }

  get preparingSelection(): boolean {
    return this.preparing || this.preparations.length > 0;
  }

  observeSelected(selected: RunChoice): void {
    if (this.acknowledgedChoice === undefined || !sameChoice(this.acknowledgedChoice, selected))
      return;
    this.acknowledgedChoice = undefined;
    this.reconcile();
  }

  request(patch: ConfigPatch): Promise<ConfigureResult> {
    return this.prepareSelection(() => patch);
  }

  prepareSelection(
    prepare: (selected: RunChoice) => ConfigPatch | undefined | Promise<ConfigPatch | undefined>,
  ): Promise<ConfigureResult> {
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

  reserveSubmission(): SubmissionSlot {
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

        if (!slot.reached) slot.configured.resolve(undefined);
        this.pump();
      },
    };
  }

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
    const touched = [...run, next];

    const carriesModel =
      this.carried.model !== undefined ||
      touched.some((intent) => intent.patch.model !== undefined);

    const carriesLevel =
      this.carried.thinkingLevel !== undefined ||
      touched.some((intent) => intent.patch.thinkingLevel !== undefined);

    this.carried = {};
    const modelPatch: ConfigPatch = carriesModel ? { model: next.choice.model } : {};
    next.patch = carriesLevel
      ? { ...modelPatch, thinkingLevel: next.choice.thinkingLevel }
      : modelPatch;

    for (const intent of run) this.settle(intent, { kind: "superseded" });
    this.inFlight = next;
    void this.dispatch(next);
  }

  private async dispatch(intent: Intent): Promise<void> {
    let result: ConfigureResult;

    try {
      const outcome = await this.options.configure(intent.patch);

      if (outcome.kind === "configured") {
        result = { kind: "acknowledged" };
      } else {
        result = { kind: "failed", message: failureMessage(outcome, intent.choice) };
      }
    } catch (cause) {
      result = { kind: "failed", message: cause instanceof Error ? cause.message : String(cause) };
    }

    this.inFlight = undefined;

    if (result.kind === "acknowledged") {
      this.acknowledgedChoice = intent.choice;

      if (!this.disposed) this.options.onAcknowledged(intent.choice, intent.patch);
    } else if (this.queue.some(isIntent)) {
      this.carried = { ...this.carried, ...intent.patch };
    } else {
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
