/**
 * Provider request options snapshotted per turn and patched by `before_request`
 * hooks. One key list drives the type, the pick from `SimpleStreamOptions`, and
 * the patch rules.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/harness/types.ts
 * Synced with pi 7ebf9087e.
 */
import type { SimpleStreamOptions } from "@nyte-ai/ai";

export const SCALAR_STREAM_OPTION_KEYS = [
  "maxRetries",
  "maxRetryDelayMs",
  "transport",
  "cacheRetention",
  "fast",
  "temperature",
  "maxTokens",
] as const;

export const RECORD_STREAM_OPTION_KEYS = ["headers", "samplingParams"] as const;

export const STREAM_OPTION_KEYS = [
  ...SCALAR_STREAM_OPTION_KEYS,
  ...RECORD_STREAM_OPTION_KEYS,
] as const satisfies readonly (keyof SimpleStreamOptions)[];

export type StreamOptions = Pick<SimpleStreamOptions, (typeof STREAM_OPTION_KEYS)[number]>;

/**
 * Per-request stream option patch returned by provider hooks. In a record
 * field, an `undefined` value deletes that key; an undefined field clears the
 * whole record.
 */
export type StreamOptionsPatch = Partial<
  Pick<StreamOptions, (typeof SCALAR_STREAM_OPTION_KEYS)[number]>
> & {
  [K in (typeof RECORD_STREAM_OPTION_KEYS)[number]]?:
    | Record<string, NonNullable<StreamOptions[K]>[string] | undefined>
    | undefined;
};

export function pickStreamOptions(options: SimpleStreamOptions): StreamOptions {
  const picked: StreamOptions = {};

  for (const key of STREAM_OPTION_KEYS) {
    if (options[key] !== undefined) Object.assign(picked, { [key]: options[key] });
  }

  return picked;
}

export function withStreamOptions(
  options: SimpleStreamOptions,
  patched: StreamOptions,
): SimpleStreamOptions {
  const next: SimpleStreamOptions = { ...options };

  for (const key of STREAM_OPTION_KEYS) {
    if (patched[key] === undefined) delete next[key];
    else Object.assign(next, { [key]: patched[key] });
  }

  return next;
}

export function applyStreamOptionsPatch(
  base: StreamOptions,
  patch: StreamOptionsPatch,
): StreamOptions {
  const next: StreamOptions = { ...base };

  for (const key of SCALAR_STREAM_OPTION_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];

    if (value === undefined) delete next[key];
    else Object.assign(next, { [key]: value });
  }

  for (const key of RECORD_STREAM_OPTION_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];

    if (value === undefined) delete next[key];
    else Object.assign(next, { [key]: patchRecord(next[key], value) });
  }

  return next;
}

export function createStreamOptionsPatch(
  base: StreamOptions,
  value: StreamOptions,
): StreamOptionsPatch {
  const patch: StreamOptionsPatch = {};

  for (const key of SCALAR_STREAM_OPTION_KEYS) {
    if (base[key] !== value[key]) Object.assign(patch, { [key]: value[key] });
  }

  for (const key of RECORD_STREAM_OPTION_KEYS) {
    const before = base[key];
    const after = value[key];

    if (before === after) continue;

    if (after === undefined) {
      Object.assign(patch, { [key]: undefined });
      continue;
    }

    const diff = diffRecord(before, after);

    if (before === undefined || Object.keys(diff).length !== 0)
      Object.assign(patch, { [key]: diff });
  }

  return patch;
}

function patchRecord<V>(
  base: Readonly<Record<string, V>> | undefined,
  patch: Readonly<Record<string, V | undefined>>,
) {
  const next = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }

  return next;
}

function diffRecord<V>(
  base: Readonly<Record<string, V>> | undefined,
  value: Readonly<Record<string, V>>,
) {
  const diff: Record<string, V | undefined> = {};

  for (const key of Object.keys(base ?? {})) {
    if (!(key in value)) diff[key] = undefined;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (base?.[key] !== entry) diff[key] = entry;
  }

  return diff;
}
