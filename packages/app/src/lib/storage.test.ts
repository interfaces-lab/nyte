import { Type } from "typebox";
import type { TSchema } from "typebox";
import { expect, test } from "vitest";
import { storedPaneLayoutSchema } from "../panes/pane-layout.ts";
import { persisted, readStored, type StorageArea } from "./storage.ts";

const KEY = "nyte:test:v1";

const width = Type.Object({ width: Type.Number() }, { additionalProperties: false });

const DEFAULT_WIDTH = { width: 280 };

const LEGACY_SPLIT = {
  version: 1,
  kind: "split",
  direction: "right",
  ratio: 0.5,
  order: ["secondary", "primary"],
  primary: { id: "primary", selection: { kind: "blank" } },
  secondary: { id: "secondary", selection: { kind: "session", sessionId: "chat-1" } },
  activePaneId: "secondary",
};

interface Row {
  readonly name: string;
  readonly stored: string | null;
  readonly schema: TSchema;
  readonly fallback: unknown;
  readonly text?: boolean;
  readonly write?: unknown;
  readonly expected: unknown;
}

const rows: readonly Row[] = [
  {
    name: "a good value",
    stored: '{"width":320}',
    schema: width,
    fallback: DEFAULT_WIDTH,
    expected: { width: 320 },
  },
  {
    name: "a missing value",
    stored: null,
    schema: width,
    fallback: DEFAULT_WIDTH,
    expected: DEFAULT_WIDTH,
  },
  {
    name: "text that isn't JSON",
    stored: '{"width":',
    schema: width,
    fallback: DEFAULT_WIDTH,
    expected: DEFAULT_WIDTH,
  },
  {
    name: "JSON of the wrong shape",
    stored: '{"width":"wide"}',
    schema: width,
    fallback: DEFAULT_WIDTH,
    expected: DEFAULT_WIDTH,
  },
  {
    name: "a write the storage refuses",
    stored: '{"width":320}',
    schema: width,
    fallback: DEFAULT_WIDTH,
    write: { width: 400 },
    expected: { width: 320 },
  },
  {
    name: "a bare string an earlier build stored for a preference",
    stored: "queue",
    schema: Type.Enum(["steer", "queue"]),
    fallback: "steer",
    text: true,
    expected: "queue",
  },
  {
    name: "a bare string where only JSON was ever stored",
    stored: "queue",
    schema: Type.Enum(["steer", "queue"]),
    fallback: "steer",
    expected: "steer",
  },
  {
    name: "a version 1 pane layout from an earlier build",
    stored: JSON.stringify(LEGACY_SPLIT),
    schema: storedPaneLayoutSchema,
    fallback: undefined,
    expected: LEGACY_SPLIT,
  },
];

function memoryArea(stored: string | null, refuse: boolean): StorageArea {
  const values = new Map(stored === null ? [] : [[KEY, stored]]);

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (refuse) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

test.each(rows)("$name", ({ stored, schema, fallback, text, write, expected }) => {
  const area = memoryArea(stored, write !== undefined);
  const value = persisted(KEY, schema, fallback, area);
  let heard = 0;
  value.subscribe(() => {
    heard += 1;
  });

  if (write !== undefined) expect(() => value.set(write)).toThrow("The quota has been exceeded.");

  expect(readStored(area, KEY, schema, fallback, { text })).toEqual(expected);

  if (text !== true) expect(value.get()).toEqual(expected);
  expect(area.getItem(KEY)).toBe(stored);
  expect(heard).toBe(0);
});
