import { createRef } from "react";
import { flushSync } from "react-dom";
import { ComposerEditor } from "../composer/composer-editor.tsx";
import type { ComposerEditorHandle } from "../composer/composer-editor.tsx";
import { attachComposerFiles } from "../composer/composer-files.ts";
import { receiveChatExcerpts } from "../../references/add-to-chat.ts";
import { capture, check, openViewer, paint, until } from "./image-viewer.fixture.tsx";
import { flattenMarkup } from "./markup.ts";

export async function run(): Promise<string> {
  await readFailure();
  await unmounting();

  return "passed";
}

async function readFailure(): Promise<void> {
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
  } finally {
    stop();
    viewer.unmount();
  }
}

/** Native decode yields even for loaded images, so synchronous unmount precedes PNG completion. */
async function unmounting(): Promise<void> {
  for (const phase of ["ready", "flatten", "delivery"] as const) {
    const gate = Promise.withResolvers<string | undefined>();
    const finished = Promise.withResolvers<void>();
    const composer = createRef<ComposerEditorHandle>();
    let calls = 0;
    let accepted = 0;
    let acceptedName: string | undefined;

    const stop = receiveChatExcerpts((excerpt) => {
      calls += 1;
      const editor = composer.current;
      const target = editor?.readElement();

      if (excerpt.image === undefined || editor === null || target === null || target === undefined)
        throw new Error("Missing image intake");

      const image = excerpt.image;
      check(image.type === "image/png", "The delivery must contain a native PNG export");

      return editor
        .attachFiles([{ file: image, kind: "file" }], excerpt.signal)
        .then(() => {
          accepted += 1;
          acceptedName = image.name;

          return target;
        })
        .finally(() => finished.resolve());
    });

    const viewer = await openViewer(
      `${phase}.png`,
      <ComposerEditor
        ref={composer}
        document={{ text: "", selectionStart: 0, selectionEnd: 0 }}
        files={[]}
        disabled={false}
        placeholder="Message"
        onKeyDown={() => {}}
        onDocumentChange={() => {}}
        onFilesSelected={() => gate.promise}
      />,
    );

    try {
      if (phase === "ready") gate.resolve(undefined);
      flushSync(() => viewer.add.click());

      if (phase === "ready") {
        await finished.promise;
        await until(
          () => document.querySelector('[role="dialog"]') === null,
          "the accepted viewer to close",
        );
        check(
          calls === 1 && accepted === 1 && acceptedName === "ready-marked.png",
          "A mounted viewer must deliver its marked PNG once",
        );
        continue;
      }

      if (phase === "delivery") await until(() => calls === 1, "the pending composer delivery");
      else check(calls === 0, "Flattening must still be pending before unmount");
      viewer.unmount();
      check(viewer.signal.aborted, `${phase}: removing the viewer must abort its export`);
      gate.resolve(undefined);

      if (phase === "delivery") await finished.promise;
      else await flattenMarkup(viewer.source, [], "encoding-barrier.png");
      await paint();
      check(
        calls === (phase === "flatten" ? 0 : 1),
        `${phase}: the removed viewer called Add to Chat after unmount (${calls} calls)`,
      );
      check(accepted === 0, `${phase}: the removed viewer delivered an image`);
    } finally {
      gate.resolve(undefined);
      stop();
      viewer.unmount();
    }
  }
}
