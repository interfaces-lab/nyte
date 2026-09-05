/**
 * The title bar over a real session, because the thing worth proving is that
 * a rename made by anyone reaches it through the log.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  TERMINAL_TITLE_BASE,
  TERMINAL_TITLE_MAX_CHARS,
  terminalTitle,
  watchTerminalTitle,
} from "../src/terminal-title.ts";
import { SqliteSessionRepo } from "@uji-ai/core/store";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function openSession() {
  const directory = mkdtempSync(join(tmpdir(), "uji-terminal-title-"));
  directories.push(directory);
  const repo = new SqliteSessionRepo(join(directory, "sessions.db"));
  const session = await repo.create();
  return {
    session,
    close: async () => {
      await session.close();
      await repo.close();
    },
  };
}

async function waitFor(seen: string[], count: number, deadlineMs = 2_000): Promise<void> {
  const until = Date.now() + deadlineMs;
  while (seen.length < count && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

void describe("terminalTitle", () => {
  void test("says uji until the chat has a name", () => {
    assert.equal(terminalTitle(undefined), TERMINAL_TITLE_BASE);
    assert.equal(terminalTitle(""), TERMINAL_TITLE_BASE);
    assert.equal(terminalTitle("   "), TERMINAL_TITLE_BASE);
    assert.equal(terminalTitle("Add a naming plugin"), "uji - Add a naming plugin");
  });

  void test("strips the escapes that would end the sequence early", () => {
    assert.equal(terminalTitle("bad\u0007bell"), "uji - bad bell");
    // The escape is what ends an OSC string; the backslash left behind is text.
    assert.equal(terminalTitle("esc\u001b\\away"), "uji - esc \\away");
    assert.equal(terminalTitle("two\nlines"), "uji - two lines");
  });

  void test("cuts a long name before the terminal does", () => {
    const title = terminalTitle("x".repeat(200));
    assert.equal(title.length <= TERMINAL_TITLE_MAX_CHARS, true);
    assert.equal(title.endsWith("…"), true);
  });
});

void describe("watchTerminalTitle", () => {
  void test("publishes the current name, then every rename", async () => {
    const opened = await openSession();
    const seen: string[] = [];
    const stop = watchTerminalTitle(opened.session, {
      setTitle: (title) => seen.push(title),
    });
    try {
      await waitFor(seen, 1);
      assert.deepEqual(seen, ["uji"]);

      await opened.session.setName("First name");
      await waitFor(seen, 2);
      assert.equal(seen.at(-1), "uji - First name");

      await opened.session.setName("Second name");
      await waitFor(seen, 3);
      assert.equal(seen.at(-1), "uji - Second name");
    } finally {
      stop();
      await opened.close();
    }
  });

  void test("opens on the name the last process left", async () => {
    const opened = await openSession();
    await opened.session.setName("Resumed chat");
    const seen: string[] = [];
    const stop = watchTerminalTitle(opened.session, {
      setTitle: (title) => seen.push(title),
    });
    try {
      await waitFor(seen, 1);
      assert.deepEqual(seen, ["uji - Resumed chat"]);
    } finally {
      stop();
      await opened.close();
    }
  });

  void test("stops writing after it is stopped", async () => {
    const opened = await openSession();
    const seen: string[] = [];
    const stop = watchTerminalTitle(opened.session, {
      setTitle: (title) => seen.push(title),
    });
    await waitFor(seen, 1);
    stop();
    await opened.session.setName("Too late");
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(seen, ["uji"]);
    await opened.close();
  });

  void test("reports a broken watch instead of throwing into the loop", async () => {
    const errors: Error[] = [];
    const stop = watchTerminalTitle(
      {
        getLog: () => Promise.reject(new Error("log is gone")),
        getName: () => Promise.resolve(undefined),
        watch: () => {
          throw new Error("unreachable");
        },
      },
      {
        setTitle: () => undefined,
        onError: (error) => errors.push(error),
      },
    );
    while (errors.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(errors[0]?.message, "log is gone");
    stop();
  });
});
