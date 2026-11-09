import { createRef } from "react";
import { flushSync } from "react-dom";
import { ComposerEditor } from "../composer/composer-editor.tsx";
import type { ComposerEditorHandle } from "../composer/composer-editor.tsx";
import { receiveChatExcerpts } from "../../references/add-to-chat.ts";
import { check, openViewer, paint, until } from "./image-viewer.fixture.tsx";
import { flattenMarkup } from "./markup.ts";

/** Native decode yields even for loaded images, so synchronous unmount precedes PNG completion. */
export async function run(): Promise<string> {
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

  return "passed";
}
