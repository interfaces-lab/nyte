export type ValidationIssue = {
  readonly severity: "error" | "warning";
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly source?: { readonly plugin: string; readonly file?: string; readonly line?: number };
};
