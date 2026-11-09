import { create, props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { Document } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { control, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { revealLabel } from "../../components/context-menu.ts";
import { nyte } from "../../contract/nyte.ts";
import { mediaUrl } from "../../data/connection.ts";
import { documentsApi } from "../../data/documents.ts";
import { formatBytes } from "../../lib/format.ts";
import { useBlobUrl } from "../../lib/use-blob-url.ts";

export type SizedFile = Extract<Document, { readonly size: number }>;

export const viewerStyles = create({
  root: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: role.bgBase,
  },
  hidden: { visibility: "hidden", pointerEvents: "none" },
  message: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s2,
    padding: space.s5,
    color: role.contentSecondary,
    textWrap: "pretty",
  },
  messageTitle: { color: role.contentPrimary, fontWeight: type.weightMedium },
  messageDetail: { overflowWrap: "anywhere" },
  image: {
    display: "grid",
    placeItems: "center",
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: space.s5,
  },
  picture: { display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" },
  status: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    minHeight: control.heightMd,
    paddingInline: space.s2_5,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingSm,
    backgroundColor: role.bgBase,
  },
  statusText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

export function FileMessage(input: {
  readonly active: boolean;
  readonly alert?: boolean;
  readonly title: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div
      aria-hidden={!input.active}
      inert={!input.active}
      {...props(viewerStyles.root, !input.active && viewerStyles.hidden)}
    >
      <div
        role={input.alert === true ? "alert" : "status"}
        {...props(text.sm, viewerStyles.message)}
      >
        <span {...props(viewerStyles.messageTitle)}>{input.title}</span>
        {input.children}
      </div>
    </div>
  );
}

export function RevealButton(input: { readonly path: string }): ReactElement | null {
  const revealPath = nyte.host.revealPath;

  if (revealPath === undefined) return null;

  return (
    <Button onClick={() => void revealPath({ path: input.path })}>
      {revealLabel(nyte.platform)}
    </Button>
  );
}

export function FileImage(input: {
  readonly active: boolean;
  readonly document: SizedFile;
}): ReactElement {
  const path = input.document.path;

  const url = useBlobUrl(["files", "bytes", path, input.document.version], async () =>
    (await documentsApi()).bytes(path),
  );

  const [broken, setBroken] = useState(false);

  if (broken)
    return <FileMessage active={input.active} alert title="The image could not be displayed." />;

  if (url.data === undefined)
    return url.isError ? (
      <FileMessage active={input.active} alert title="The image could not be loaded.">
        <span {...props(viewerStyles.messageDetail)}>{url.error.message}</span>
        <Button onClick={() => void url.refetch()}>Retry</Button>
      </FileMessage>
    ) : (
      <FileMessage active={input.active} title="Opening file…" />
    );

  return (
    <div
      aria-hidden={!input.active}
      inert={!input.active}
      {...props(viewerStyles.root, !input.active && viewerStyles.hidden)}
    >
      <div {...props(viewerStyles.image)}>
        <img
          src={url.data}
          alt={path.split("/").at(-1)}
          onError={() => setBroken(true)}
          {...props(viewerStyles.picture)}
        />
      </div>
      <div {...props(viewerStyles.status)}>
        <span {...props(viewerStyles.statusText)}>
          {input.document.mime} · {formatBytes(input.document.size)}
        </span>
      </div>
    </div>
  );
}

export function FileVideo(input: {
  readonly active: boolean;
  readonly document: SizedFile;
}): ReactElement {
  const path = input.document.path;
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<"unsupported" | "stopped">();
  const progress = useRef({ renewed: false, at: 0 });
  const details = `${input.document.mime} · ${formatBytes(input.document.size)}`;

  const url = useQuery({
    queryKey: ["files", "media", path, input.document.version, attempt],
    queryFn: () => mediaUrl(path),
  });

  const renew = (at: number): void => {
    progress.current = { renewed: true, at };
    setFailure(undefined);
    setAttempt((current) => current + 1);
  };

  if (failure === "unsupported")
    return (
      <FileMessage active={input.active} title="This video can't be played here.">
        <span>{details}</span>
        <RevealButton path={path} />
      </FileMessage>
    );

  if (url.data === undefined || failure === "stopped")
    return url.isError || failure === "stopped" ? (
      <FileMessage active={input.active} alert title="The video could not be loaded.">
        {url.isError && <span {...props(viewerStyles.messageDetail)}>{url.error.message}</span>}
        <Button onClick={() => renew(progress.current.at)}>Retry</Button>
      </FileMessage>
    ) : (
      <FileMessage active={input.active} title="Opening file…" />
    );

  return (
    <div
      aria-hidden={!input.active}
      inert={!input.active}
      {...props(viewerStyles.root, !input.active && viewerStyles.hidden)}
    >
      <div {...props(viewerStyles.image)}>
        <video
          ref={(video) => {
            if (!input.active) video?.pause();
          }}
          src={url.data}
          controls
          preload="metadata"
          aria-label={path.split("/").at(-1)}
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = progress.current.at;
            progress.current = { renewed: false, at: progress.current.at };
          }}
          onError={(event) => {
            const video = event.currentTarget;
            const at = video.currentTime > 0 ? video.currentTime : progress.current.at;

            if (!progress.current.renewed) {
              renew(at);

              return;
            }

            progress.current = { renewed: true, at };
            setFailure(
              video.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
                ? "unsupported"
                : "stopped",
            );
          }}
          {...props(viewerStyles.picture)}
        />
      </div>
      <div {...props(viewerStyles.status)}>
        <span {...props(viewerStyles.statusText)}>{details}</span>
      </div>
    </div>
  );
}
