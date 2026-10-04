/**
 * A registry is a list of contributions and the state they produce. Rebuild
 * replays every contribution over a fresh draft in plugin order; removing a
 * plugin means dropping its contributions and rebuilding. There is no undo.
 */
import type { TSchema } from "typebox";
import { bindTool } from "../tools/bind-tool.ts";
import type { AgentTool } from "../kernel/loop/types.ts";
import type { Disposer, Draft, ToolDraft } from "./types.ts";

export interface RegistryDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  readonly errors: readonly { owner: string; message: string }[];
}

interface Contribution<D> {
  owner: string;
  /** Plugin position in the activation order. Contributions replay sorted by it, then by registration. */
  order: number;
  fn: (draft: D) => void;
  removed: boolean;
}

export class MapDraft<T> implements Draft<T> {
  protected readonly entries = new Map<string, T>();
  /** Entry id to the plugin that set it. Stamped by the registry as it replays; an update keeps it. */
  private readonly ownerById = new Map<string, string>();
  private owner = "";

  /** Host-only: whose contribution is replaying. Never reaches the author-facing `Draft`. */
  beginOwner(owner: string): void {
    this.owner = owner;
  }
  owners(): Map<string, string> {
    return new Map(this.ownerById);
  }

  set(id: string, value: T): void {
    this.entries.set(id, value);
    this.ownerById.set(id, this.owner);
  }
  update(id: string, fn: (current: T) => T): void {
    const current = this.entries.get(id);

    if (current === undefined) throw new Error(`no entry "${id}" to update`);
    this.entries.set(id, fn(current));
  }
  delete(id: string): void {
    this.entries.delete(id);
    this.ownerById.delete(id);
  }
  has(id: string): boolean {
    return this.entries.has(id);
  }
  get(id: string): T | undefined {
    return this.entries.get(id);
  }
  ids(): readonly string[] {
    return [...this.entries.keys()];
  }
  toMap(): Map<string, T> {
    return new Map(this.entries);
  }
}

/** Pairs every contributed tool with its argument validation, once per tool object. */
export class ToolMapDraft extends MapDraft<AgentTool> implements ToolDraft {
  private readonly bindings: WeakMap<object, AgentTool>;

  constructor(bindings = new WeakMap<object, AgentTool>()) {
    super();
    this.bindings = bindings;
  }

  override set<T extends TSchema, Details>(id: string, tool: AgentTool<T, Details>): void {
    const bound = this.bindings.get(tool) ?? bindTool(tool);
    this.bindings.set(tool, bound);
    super.set(id, bound);
  }

  wrap(id: string, wrap: (inner: AgentTool["execute"]) => AgentTool["execute"]): void {
    this.update(id, (tool) => ({ ...tool, execute: wrap(tool.execute) }));
  }
}

type OwnedDraft<T> = {
  toMap(): Map<string, T>;
  beginOwner(owner: string): void;
  owners(): Map<string, string>;
};

export class ContributionRegistry<T, D extends Draft<T>> {
  private contributions: Contribution<D>[] = [];
  private state = new Map<string, T>();
  private ownerById = new Map<string, string>();
  private rebuilding = false;
  private preview: ContributionRegistry<T, D> | undefined;
  private readonly makeDraft: () => D & OwnedDraft<T>;
  private orderByOwner = new Map<string, number>();

  constructor(makeDraft: () => D & OwnedDraft<T>) {
    this.makeDraft = makeDraft;
  }

  add(owner: string, order: number, fn: (draft: D) => void): Disposer {
    const contribution: Contribution<D> = { owner, order, fn, removed: false };
    this.contributions.push(contribution);

    return () => {
      contribution.removed = true;
    };
  }

  rebuild(): RegistryDiff {
    if (this.rebuilding) throw new Error("rebuild() cannot run inside a contribution");
    this.rebuilding = true;
    const draft = this.makeDraft();
    const errors: { owner: string; message: string }[] = [];
    const ordered = this.contributions
      .filter((contribution) => !contribution.removed)
      .sort(
        (a, b) =>
          (this.orderByOwner.get(a.owner) ?? a.order) - (this.orderByOwner.get(b.owner) ?? b.order),
      );

    try {
      for (const contribution of ordered) {
        draft.beginOwner(contribution.owner);

        try {
          const returned: unknown = contribution.fn(draft);

          if (returned instanceof Promise) {
            throw new Error("contributions are synchronous; this one returned a promise");
          }
        } catch (error) {
          errors.push({
            owner: contribution.owner,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this.rebuilding = false;
    }

    const next = draft.toMap();
    const diff = diffMaps(this.state, next);
    this.state = next;
    this.ownerById = draft.owners();

    return { ...diff, errors };
  }

  stage(excluded: ReadonlySet<string>, orderByOwner: Map<string, number>) {
    const staged = new ContributionRegistry(this.makeDraft);
    const inherited = new Set(this.contributions);
    const refresh = (): void => {
      const own = staged.contributions.filter((contribution) => !inherited.has(contribution));
      for (const contribution of this.contributions) inherited.add(contribution);
      staged.contributions = [
        ...this.contributions.filter((contribution) => !excluded.has(contribution.owner)),
        ...own,
      ].filter((contribution) => !contribution.removed);
    };
    staged.contributions = this.contributions.filter(
      (contribution) => !contribution.removed && !excluded.has(contribution.owner),
    );
    staged.orderByOwner = orderByOwner;
    staged.state = this.state;
    staged.ownerById = this.ownerById;

    return {
      registry: staged,
      refresh,
      preview: () => {
        this.preview = staged;
      },
      stopPreview: () => {
        this.preview = undefined;
      },
      commit: () => {
        this.contributions = staged.contributions;
        this.state = staged.state;
        this.ownerById = staged.ownerById;
        this.orderByOwner = staged.orderByOwner;
      },
    };
  }

  current(): ReadonlyMap<string, T> {
    return this.state;
  }

  contributionValues(): T[] {
    return this.preview?.values() ?? this.values();
  }

  /** Plugin that last wrote this entry, for provenance a client renders. */
  owner(id: string): string | undefined {
    return this.ownerById.get(id);
  }

  get(id: string): T | undefined {
    return this.current().get(id);
  }

  values(): T[] {
    return [...this.current().values()];
  }
}

function diffMaps<T>(
  before: ReadonlyMap<string, T>,
  after: ReadonlyMap<string, T>,
): Omit<RegistryDiff, "errors"> {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [id, value] of after) {
    if (!before.has(id)) added.push(id);
    else if (before.get(id) !== value) changed.push(id);
  }

  for (const id of before.keys()) if (!after.has(id)) removed.push(id);

  return { added, removed, changed };
}
