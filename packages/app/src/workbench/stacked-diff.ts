const FAILED_PATCH = "The patch could not be read.";

export const EMPTY_PATCH = "No text diff is available for this file.";

export type ChangeStackSection =
  | { readonly kind: "diff"; readonly path: string; readonly patch: string }
  | { readonly kind: "raw"; readonly path: string; readonly text: string }
  | { readonly kind: "notice"; readonly path: string; readonly text: string }
  | { readonly kind: "pending"; readonly path: string };

export type UncommittedPatch =
  | { readonly kind: "pending" }
  | { readonly kind: "failed" }
  | { readonly kind: "empty" }
  | { readonly kind: "ready"; readonly patch: string };

export function uncommittedStackSection({
  path,
  state,
}: {
  readonly path: string;
  readonly state: UncommittedPatch;
}): ChangeStackSection {
  switch (state.kind) {
    case "pending":
      return { kind: "pending", path };
    case "failed":
      return { kind: "notice", path, text: FAILED_PATCH };
    case "empty":
      return { kind: "notice", path, text: EMPTY_PATCH };
    case "ready":
      return { kind: "diff", path, patch: state.patch };
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}
