import { AttachmentTrigger } from "@nyte-ai/ui/attachment";
import { Button } from "@nyte-ai/ui/button";
import { Morph } from "@nyte-ai/ui/morph";
import { floatingSurfaceStyles } from "@nyte-ai/ui/styles/floating-surface.stylex";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { Loader } from "@nyte-ai/ui/loader";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { create, props } from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { loadDeferred, readDeferred } from "../../lib/deferred.tsx";
import { imageViewerStyles } from "./image-viewer.stylex.ts";
import type { Mark } from "./markup.ts";

const styles = create({
  trigger: {
    appearance: "none",
    position: "relative",
    display: "inline-flex",
    maxWidth: "100%",
    flexShrink: 0,
    padding: 0,
    borderStyle: "none",
    borderRadius: radius.control,
    backgroundColor: "transparent",
    boxShadow: "none",
    cursor: "zoom-in",
    verticalAlign: "middle",
  },
  loading: { display: "flex", alignItems: "center", gap: space.s2, padding: space.s2 },
});

export function ImageViewer(input: {
  readonly src: string;
  readonly name: string;
  readonly children: ReactElement;
}): ReactElement {
  const id = useId();
  const actions = useRef<{ close: () => void; unmount: () => void } | null>(null);
  const closeControl = useRef<HTMLButtonElement | null>(null);
  const shortcuts = useRef<((event: KeyboardEvent<HTMLDivElement>) => void) | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const sequence = useRef(0);
  const current = useRef<AbortController | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [runtime, setRuntime] = useState(() => readDeferred("images"));
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<Mark | undefined>(undefined);
  const destination = useRef<HTMLElement | undefined>(undefined);

  const [visit, setVisit] = useState<
    | {
        readonly id: number;
        readonly controller: AbortController;
      }
    | undefined
  >(undefined);

  useMountEffect(() => () => current.current?.abort());

  const close = (target?: HTMLElement): void => {
    destination.current = target;
    actions.current?.close();
  };

  return (
    <Morph.Root
      open={open}
      actionsRef={actions}
      triggerId={id}
      onOpenChange={(next, details) => {
        if (!next && details.reason === "escape-key" && draft !== undefined) {
          details.cancel();
          setDraft(undefined);

          return;
        }

        if (!next) {
          current.current?.abort();
          setOpen(false);

          return;
        }

        if (current.current !== undefined && !current.current.signal.aborted) return;
        const controller = new AbortController();
        current.current = controller;
        sequence.current += 1;
        setVisit({
          id: sequence.current,
          controller,
        });
        destination.current = undefined;
        setImage(null);
        setDraft(undefined);
        setError(false);
        setOpen(true);
        void loadDeferred("images")
          .then((loaded) => {
            if (current.current === controller && !controller.signal.aborted) setRuntime(loaded);
          })
          .catch(() => {
            if (current.current === controller && !controller.signal.aborted) setError(true);
          });
      }}
      onOpenChangeComplete={(next) => {
        if (next || current.current?.signal.aborted !== true) return;
        setVisit(undefined);
        setDraft(undefined);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <AttachmentTrigger
              aria-label={`Preview ${input.name}`}
              render={
                <Morph.Trigger id={id} xstyle={[surfaceTheme.gray, styles.trigger, focus.ring]} />
              }
            >
              {input.children}
            </AttachmentTrigger>
          }
        />
        <TooltipContent>{input.name}</TooltipContent>
      </Tooltip>
      <Morph.Portal>
        <Morph.Backdrop />
        {visit !== undefined && (
          <Morph.Popup
            xstyle={imageViewerStyles.popup}
            initialFocus={closeControl}
            onKeyDown={(event) => shortcuts.current?.(event)}
            finalFocus={() => destination.current ?? true}
          >
            <div
              aria-hidden="true"
              {...props(
                imageViewerStyles.surface,
                floatingSurfaceStyles.material,
                floatingSurfaceStyles.modalPopup,
                hairline.ringAfter,
              )}
            />
            <div data-image-frame="" {...props(imageViewerStyles.frame)}>
              <img
                src={input.src}
                alt={input.name}
                draggable={false}
                {...props(imageViewerStyles.image)}
                onLoad={(event) => setImage(event.currentTarget)}
                onError={() => setError(true)}
              />
              <div {...props(imageViewerStyles.close)}>
                <Morph.Close
                  ref={closeControl}
                  render={<Button size="lg" iconOnly aria-label="Close image preview" icon="x" />}
                />
              </div>
              {runtime === undefined || image === null ? (
                <>
                  <div {...props(imageViewerStyles.header, styles.loading)}>
                    <Morph.Title xstyle={text.base}>{input.name}</Morph.Title>
                  </div>
                  <div role="status" {...props(imageViewerStyles.footer, text.sm, styles.loading)}>
                    {error ? (
                      "The image viewer could not be opened. Close it and try again."
                    ) : (
                      <>
                        <Loader />
                        Loading image viewer…
                      </>
                    )}
                  </div>
                </>
              ) : (
                <runtime.ImageViewerPopup
                  key={visit.id}
                  source={image}
                  shortcuts={shortcuts}
                  name={input.name}
                  signal={visit.controller.signal}
                  draft={draft}
                  onDraft={setDraft}
                  onClose={close}
                />
              )}
            </div>
          </Morph.Popup>
        )}
      </Morph.Portal>
    </Morph.Root>
  );
}
