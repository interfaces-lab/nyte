import type { Dialog } from "../../src/model/dialogs/dialog.ts";
import type { ListDialog } from "../../src/model/dialogs/list.ts";
import { deriveScreen } from "../../src/model/screen.ts";
import type { State } from "../../src/model/state.ts";
import { buildView } from "../fixture/view.ts";

export const idle = buildView((v) =>
  v.turn("t1", (t) => t.user("hi").text("ok").ended("completed")),
);

export function top(state: State): Dialog | null {
  return deriveScreen(state, null).dialog;
}

export function key(name: string) {
  return { kind: "dialog", command: { kind: "key", name } } as const;
}

export function list(items: readonly string[], extra: Partial<ListDialog> = {}): ListDialog {
  return {
    kind: "list",
    id: "d",
    purpose: { kind: "palette" },
    title: "t",
    choices: {
      kind: "ready",
      items: items.map((id) => ({
        id,
        label: id,
        description: `${id} description`,
        timing: null,
        status: null,
        mark: null,
      })),
    },
    query: "",
    highlighted: 0,
    answering: null,
    busy: false,
    ...extra,
  };
}
