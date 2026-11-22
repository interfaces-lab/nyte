import { Button } from "@nyte-ai/ui/button";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { control, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { DragEvent, ReactElement } from "react";
import { MarkedPhoto } from "./markup-art.tsx";
import type { Tone } from "./markup-art.tsx";
import { exportMarkup, outputTransform } from "./markup-export.tsx";
import type { Edit, Size } from "./markup-geometry.ts";
import { imageViewer } from "../theme/schema.stylex.ts";
import type { Mark } from "./markup.ts";

const SPANS = [1, 1.25, 1.5, 1.75, 2] as const;

const styles = create({
  art: {
    display: "block",
    width: `calc(100% - ${space.s1} * 2)`,
    height: `calc(100% - ${space.s1} * 2)`,
    borderRadius: `calc(${radius.control} - ${space.s1})`,
  },
  preview: {
    position: "fixed",
    insetBlockStart: 0,
    insetInlineStart: -10_000,
    width: `calc(${imageViewer.thumbnailSize} * 2)`,
    borderRadius: radius.control,
    pointerEvents: "none",
  },
});

const spans = create({
  1: { width: control.heightLg },
  1.25: { width: `calc(${control.heightLg} * 1.25)` },
  1.5: { width: `calc(${control.heightLg} * 1.5)` },
  1.75: { width: `calc(${control.heightLg} * 1.75)` },
  2: { width: `calc(${control.heightLg} * 2)` },
});

interface Prepared {
  readonly edit: Edit;
  readonly marks: readonly Mark[];
  readonly file: File;
  readonly url: string;
}

export function MarkupDragOut(input: {
  readonly image: HTMLImageElement;
  readonly size: Size;
  readonly edit: Edit;
  readonly marks: readonly Mark[];
  readonly tone: Tone;
  readonly name: string;
  readonly onAway: (away: boolean) => void;
  readonly onDroppedInChat: (target: HTMLElement) => void;
}): ReactElement {
  const [note, setNote] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const prepared = useRef<Prepared | undefined>(undefined);

  const pending = useRef<{ readonly edit: Edit; readonly marks: readonly Mark[] } | undefined>(
    undefined,
  );

  const disposed = useRef(false);
  const preview = useRef<HTMLImageElement | null>(null);
  const landed = useRef<HTMLElement | undefined>(undefined);
  const lifting = useRef<number | undefined>(undefined);

  const [watchDrop] = useState(() => (event: globalThis.DragEvent) => {
    landed.current = event.target instanceof HTMLElement ? event.target : undefined;
  });

  const output = {
    width: Math.max(1, Math.round(input.edit.crop.w)),
    height: Math.max(1, Math.round(input.edit.crop.h)),
  };

  const aspect = output.width / output.height;

  const span = SPANS.reduce((best, each) =>
    Math.abs(each - aspect) < Math.abs(best - aspect) ? each : best,
  );

  useMountEffect(() => () => {
    disposed.current = true;

    if (lifting.current !== undefined) cancelAnimationFrame(lifting.current);
    window.removeEventListener("drop", watchDrop, { capture: true });

    if (prepared.current !== undefined) URL.revokeObjectURL(prepared.current.url);
  });

  const current = (made: { readonly edit: Edit; readonly marks: readonly Mark[] } | undefined) =>
    made !== undefined && made.edit === input.edit && made.marks === input.marks;

  const prepare = (): void => {
    if (current(prepared.current) || current(pending.current)) return;

    const made = { edit: input.edit, marks: input.marks };

    pending.current = made;
    exportMarkup(input.image, made.edit, made.marks, input.tone, input.name).then(
      (file) => {
        if (disposed.current || pending.current !== made) return;

        pending.current = undefined;

        if (prepared.current !== undefined) URL.revokeObjectURL(prepared.current.url);
        prepared.current = { ...made, file, url: URL.createObjectURL(file) };
        setPreviewUrl(prepared.current.url);
        setNote("");
      },
      () => {
        if (disposed.current || pending.current !== made) return;

        pending.current = undefined;
        setNote("The image could not be prepared for dragging. Use Add to Chat instead.");
      },
    );
  };

  const start = (event: DragEvent<HTMLButtonElement>): void => {
    const ready = prepared.current;

    if (ready === undefined || !current(ready)) {
      event.preventDefault();
      prepare();
      setNote("Preparing the image. Drag it again in a moment.");

      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.items.add(ready.file);
    event.dataTransfer.setData("DownloadURL", `image/png:${ready.file.name}:${ready.url}`);

    const lifted = preview.current;

    if (lifted !== null && lifted.complete && lifted.src === ready.url) {
      event.dataTransfer.setDragImage(lifted, lifted.offsetWidth / 2, lifted.offsetHeight / 2);
    } else {
      event.dataTransfer.setDragImage(
        event.currentTarget,
        event.currentTarget.offsetWidth / 2,
        event.currentTarget.offsetHeight / 2,
      );
    }

    landed.current = undefined;
    window.addEventListener("drop", watchDrop, { capture: true, once: true });
    lifting.current = requestAnimationFrame(() => {
      lifting.current = undefined;
      input.onAway(true);
    });
  };

  const end = (event: DragEvent<HTMLButtonElement>): void => {
    window.removeEventListener("drop", watchDrop, { capture: true });

    if (lifting.current !== undefined) cancelAnimationFrame(lifting.current);
    lifting.current = undefined;
    input.onAway(false);

    if (landed.current !== undefined && event.dataTransfer.dropEffect !== "none") {
      input.onDroppedInChat(landed.current);
    }
  };

  return (
    <>
      <Button
        size="lg"
        variant="outline"
        iconOnly
        draggable
        tabIndex={-1}
        aria-label="Drag Marked Image"
        title="Drag into the chat or another app"
        xstyle={spans[span]}
        onPointerEnter={prepare}
        onDragStart={start}
        onDragEnd={end}
      >
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${output.width} ${output.height}`}
          preserveAspectRatio="xMidYMid slice"
          {...props(styles.art)}
        >
          <MarkedPhoto
            src={input.image.currentSrc || input.image.src}
            size={input.size}
            transform={outputTransform(input.size, input.edit)}
            marks={input.marks}
            tone={input.tone}
            prefix="t"
          />
        </svg>
      </Button>
      {previewUrl !== undefined && (
        <img ref={preview} src={previewUrl} alt="" aria-hidden="true" {...props(styles.preview)} />
      )}
      <span role="status" aria-live="polite" {...props(srOnly)}>
        {note}
      </span>
    </>
  );
}
