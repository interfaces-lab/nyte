/**
 * The client's two boundary rules, checked over the source: the interface
 * reaches the host only through `@nyte-ai/sdk` (and plugins through
 * `@nyte-ai/plugin`), and it reads views rather than events, so no file
 * names a session event, a fold, or an outbox of its own.
 */
import assert from "node:assert/strict";
import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

const root = join(import.meta.dirname, "..");

async function sources(): Promise<readonly { readonly path: string; readonly text: string }[]> {
  const files: { path: string; text: string }[] = [];

  for await (const path of glob(["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"], { cwd: root })) {
    if (path.endsWith("client-rules.test.ts")) continue;
    files.push({ path, text: await readFile(join(root, path), "utf8") });
  }

  return files;
}

test("no source imports core, protocol, host or the old client", async () => {
  const offenders = (await sources()).filter(({ text }) =>
    /from "@nyte-ai\/(core|protocol|host|client|server|telemetry)(\/[^"]*)?"/u.test(text),
  );

  assert.deepEqual(
    offenders.map((file) => file.path),
    [],
  );
});

test("no source subscribes to session events, folds them, or keeps its own outbox", async () => {
  const offenders = (await sources()).filter(({ text }) =>
    /\b(SessionEvent|DurableEvent|PatchEvent|SessionObserver|createOutbox)\b|\.events\(|live-fold|use-outbox|outbox-storage/u.test(
      text,
    ),
  );

  assert.deepEqual(
    offenders.map((file) => file.path),
    [],
  );
});
