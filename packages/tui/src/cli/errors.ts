import type { Json } from "@nyte-ai/sdk";

const REASONS = {
  unknown_command: "usage",
  unknown_option: "usage",
  invalid_arguments: "usage",
  missing_input: "missing_input",
  not_found: "not_found",
  conflict: "conflict",
  host_not_running: "missing_input",
  input_required: "missing_input",
  run_stopped: "conflict",
  auth_required: "auth",
  permission_denied: "permission",
  network_error: "network",
  failed: "platform",
  run_failed: "platform",
  unknown_outcome: "unknown_outcome",
  internal_error: "bug",
  canceled: "canceled",
} as const;

export type Reason = keyof typeof REASONS;

export type ErrorClass = (typeof REASONS)[Reason];

export interface NextStep {
  readonly label: string;
  readonly argv: readonly string[];
}

export interface DetailRow {
  readonly label: string;
  readonly value: string;
}

export class CliError extends Error {
  readonly reason: Reason;
  readonly next: readonly NextStep[];
  readonly details: readonly DetailRow[];
  readonly data: { readonly [key: string]: Json } | undefined;

  constructor(
    reason: Reason,
    message: string,
    options: {
      readonly next?: readonly NextStep[];
      readonly details?: readonly DetailRow[];
      readonly data?: { readonly [key: string]: Json };
    } = {},
  ) {
    super(message);
    this.reason = reason;
    this.next = options.next ?? [];
    this.details = options.details ?? [];
    this.data = options.data;
  }
}

export function errorClass(reason: Reason): ErrorClass {
  return REASONS[reason];
}

export function exitCode(reason: Reason): 1 | 2 | 130 {
  const kind = errorClass(reason);

  if (kind === "canceled") return 130;

  return kind === "usage" || kind === "missing_input" ? 2 : 1;
}

export function jsonStatus(reason: Reason): "action_required" | "error" {
  const kind = errorClass(reason);

  return kind === "missing_input" || kind === "auth" ? "action_required" : "error";
}

export function suggest(word: string, names: readonly string[]): string | undefined {
  const typed = word.toLowerCase();
  let best: { readonly name: string; readonly distance: number } | undefined;

  for (const name of names) {
    const distance = editDistance(typed, name.toLowerCase());

    if (
      distance <= 2 &&
      distance < typed.length &&
      (best === undefined || distance < best.distance)
    )
      best = { name, distance };
  }

  return best?.name;
}

export function shellCommand(argv: readonly string[]): string {
  return argv
    .map((arg) =>
      /^[A-Za-z0-9_./=:@%+,-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`,
    )
    .join(" ");
}

function editDistance(from: string, to: string): number {
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index);

  for (let row = 1; row <= from.length; row++) {
    const current = [row];

    for (let column = 1; column <= to.length; column++) {
      const cost = from[row - 1] === to[column - 1] ? 0 : 1;

      current.push(
        Math.min(
          (previous[column] ?? 0) + 1,
          (current[column - 1] ?? 0) + 1,
          (previous[column - 1] ?? 0) + cost,
        ),
      );
    }

    previous = current;
  }

  return previous[to.length] ?? 0;
}
