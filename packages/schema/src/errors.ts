/**
 * Returns one problem found while validating input or loading a plugin.
 *
 * @category errors
 * @since 0.1.0
 */
export type ValidationIssue = { readonly severity: "error" | "warning"; readonly path: readonly (string | number)[]; readonly message: string; readonly source?: { readonly plugin: string; readonly file?: string; readonly line?: number } }
