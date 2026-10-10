import type { Schema, ValidationIssue } from "@nyte-ai/schema";

/** Returns a value a schema validated, or the issues it found. */
export type Checked<T> =
  | { readonly kind: "valid"; readonly value: T }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] };

/** Validates a value with a Standard Schema, mapping its issues to `ValidationIssue`s. */
export async function check<T>(schema: Schema<T>, value: unknown): Promise<Checked<T>> {
  const result = await schema["~standard"].validate(value);

  if (result.issues === undefined) return { kind: "valid", value: result.value };

  return {
    kind: "invalid",
    issues: result.issues.map((found) => ({
      severity: "error",
      path: (found.path ?? []).map((segment) => {
        const key = typeof segment === "object" ? segment.key : segment;

        return typeof key === "symbol" ? String(key) : key;
      }),
      message: found.message,
    })),
  };
}
