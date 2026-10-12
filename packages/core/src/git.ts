import type {
  BlameView,
  ChangeSet,
  Cursor,
  DiffOptions,
  GitCommitView,
  GitFileSides,
  GitOutcome,
  GitRefsView,
  GitScope,
  GitStatus,
  GitWrite,
  Paged,
  PatchSet,
} from "@nyte-ai/schema";

export interface GitApi {
  status(): Promise<GitStatus>;
  watch(): AsyncIterable<GitStatus>;

  changes(scope: GitScope, options?: DiffOptions): Promise<ChangeSet>;
  watchChanges(scope: GitScope, options?: DiffOptions): AsyncIterable<ChangeSet>;
  patches(
    scope: GitScope,
    paths: readonly string[],
    options?: DiffOptions,
  ): AsyncIterable<PatchSet>;
  contents(path: string, scope: GitScope): Promise<GitFileSides>;

  log(input?: { readonly cursor?: Cursor; readonly limit?: number }): Promise<Paged<GitCommitView>>;
  refs(): Promise<GitRefsView>;
  blame(path: string): Promise<BlameView>;

  stage(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  unstage(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  discard(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  commit(
    input: { readonly message: string; readonly files: "staged" | "all" | readonly string[] },
    options?: GitWrite,
  ): Promise<GitOutcome>;
  branch(
    input: { readonly name: string; readonly checkout: boolean },
    options?: GitWrite,
  ): Promise<GitOutcome>;
  push(input?: { readonly setUpstream?: boolean }, options?: GitWrite): Promise<GitOutcome>;
}
