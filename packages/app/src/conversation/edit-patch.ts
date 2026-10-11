import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ToolMessage } from "../view-helpers.ts";

const EditArgs = Type.Object({
  path: Type.String(),
  edits: Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() })),
});

const WriteArgs = Type.Object({ path: Type.String(), content: Type.String() });

/** The text a diff draws and the counts beside it. */
export interface EditPatch {
  readonly patch: string;
  readonly added: number;
  readonly removed: number;
}

function lines(text: string): readonly string[] {
  return text === "" ? [] : text.replace(/\n$/u, "").split("\n");
}

/**
 * An edit or write call's own change as a unified patch: each replacement a
 * hunk of its old and new text, a write one hunk of added lines. Line numbers
 * count from the replacement, since the call carries no position; the counts
 * are the settled call's own when it reported them.
 */
export function editPatch(message: ToolMessage): EditPatch | undefined {
  const { args } = message.state;
  const hunks: string[] = [];
  let added = 0;
  let removed = 0;
  let path = "";

  if (Value.Check(EditArgs, args)) {
    path = args.path;

    for (const edit of args.edits) {
      const before = lines(edit.oldText);
      const after = lines(edit.newText);
      hunks.push(
        `@@ -1,${String(before.length)} +1,${String(after.length)} @@`,
        ...before.map((line) => `-${line}`),
        ...after.map((line) => `+${line}`),
      );
      added += after.length;
      removed += before.length;
    }
  } else if (Value.Check(WriteArgs, args)) {
    path = args.path;
    const after = lines(args.content);
    hunks.push(`@@ -0,0 +1,${String(after.length)} @@`, ...after.map((line) => `+${line}`));
    added = after.length;
  } else {
    return undefined;
  }

  if (hunks.length === 0) return undefined;
  const counts =
    message.state.phase === "settled" && message.state.changes !== null
      ? message.state.changes
      : { added, removed };

  return {
    patch: [`--- a/${path}`, `+++ b/${path}`, ...hunks, ""].join("\n"),
    added: counts.added,
    removed: counts.removed,
  };
}
