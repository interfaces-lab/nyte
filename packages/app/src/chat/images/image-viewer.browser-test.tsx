import { createRef } from "react";
import { flushSync } from "react-dom";
import { ComposerEditor } from "../composer/composer-editor.tsx";
import type { ComposerEditorHandle } from "../composer/composer-editor.tsx";
import { attachComposerFiles } from "../composer/composer-files.ts";
import { receiveChatExcerpts } from "../../references/add-to-chat.ts";
import { capture, check, openViewer, until } from "./image-viewer.fixture.tsx";

export async function run(): Promise<string> {
  const directory = await navigator.storage.getDirectory();
  const composer = createRef<ComposerEditorHandle>();
  let readError: string | undefined;
  let attached = 0;
  let delivered = 0;

  const stop = receiveChatExcerpts(async (excerpt) => {
    if (excerpt.image === undefined) throw new Error("Expected a marked PNG");
    delivered += 1;
    const handle = await directory.getFileHandle("unreadable.png", { create: true });
    const writer = await handle.createWritable();
    await writer.write(excerpt.image);
    await writer.close();
    const file = await handle.getFile();
    await directory.removeEntry("unreadable.png");
    const editor = composer.current;
    const target = editor?.readElement();

    if (editor === null || target === null || target === undefined)
      throw new Error("Missing composer");
    await editor.attachFiles([{ file, kind: "file" }], excerpt.signal);

    return target;
  });

  const viewer = await openViewer(
    "read-failure.png",
    <ComposerEditor
      ref={composer}
      document={{ text: "", selectionStart: 0, selectionEnd: 0 }}
      files={[]}
      disabled={false}
      placeholder="Message"
      onKeyDown={() => {}}
      onDocumentChange={() => {}}
      onFilesSelected={async (files) => {
        const result = await attachComposerFiles({ files, editor: composer.current });
        attached += result.attachments.length;
        readError = result.error;

        return result.error;
      }}
    />,
  );

  try {
    const before = document.querySelector('[data-image-mark="box"]')?.innerHTML;
    flushSync(() => viewer.add.click());
    await until(() => readError !== undefined, "the real FileReader failure");
    await until(
      () => document.querySelector('[role="alert"]') !== null,
      "the viewer's read-error alert",
    );
    check(
      document.querySelector('[role="alert"]')?.textContent === "Some images could not be read.",
      "The viewer must report the actual composer read failure",
    );
    check(
      document.querySelector('[data-image-mark="box"]')?.innerHTML === before,
      "A failed read must keep the existing mark",
    );
    check(
      document.querySelector('[role="dialog"]') !== null,
      "A failed read must leave the viewer open",
    );
    check(!viewer.add.disabled, "A failed read must allow retry");
    check(delivered === 1 && attached === 0, "The failed read must not attach an image");
    await capture("renderer-read-error-keeps-marks");

    return "passed";
  } finally {
    stop();
    viewer.unmount();
  }
}
