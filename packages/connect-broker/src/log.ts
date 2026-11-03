/**
 * Structured logs. Fields are ids, counts, and codes; tokens, keys, digests,
 * and upstream bodies never reach a log line.
 */
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export const consoleLogger: Logger = {
  info: (event, fields) => console.info(JSON.stringify({ level: "info", event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ level: "warn", event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields })),
};

/** An error's class name, which is all a log line says about an unexpected failure. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
