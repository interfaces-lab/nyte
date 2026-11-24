import { props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { documentsApi } from "../data/documents.ts";
import { loadDeferred, useDeferred } from "../lib/deferred.tsx";
import type { DeferredRuntimes } from "../lib/deferred-entries.ts";
import { formatBytes } from "../lib/format.ts";
import { FileMessage, RevealButton, viewerStyles } from "./file-viewers.tsx";
import type { SizedFile } from "./file-viewers.tsx";
import { pdfQuery } from "./pdf-query.ts";

export function FilePdf(input: {
  readonly active: boolean;
  readonly document: SizedFile;
}): ReactElement {
  const runtime = useDeferred("pdf");

  useMountEffect(() => {
    void loadDeferred("pdf").catch(() => undefined);
  });

  if (runtime === "failed") {
    return (
      <FileMessage active={input.active} title="PDFs can't be previewed here.">
        <span>PDF · {formatBytes(input.document.size)}</span>
        <RevealButton path={input.document.path} />
      </FileMessage>
    );
  }

  if (runtime === undefined) return <FileMessage active={input.active} title="Opening file…" />;

  return <PdfDocument {...input} runtime={runtime} />;
}

function PdfDocument(input: {
  readonly active: boolean;
  readonly document: SizedFile;
  readonly runtime: DeferredRuntimes["pdf"];
}): ReactElement {
  const path = input.document.path;
  const runtime = input.runtime;

  const pdf = useQuery(
    pdfQuery(
      path,
      input.document.version,
      async () => (await documentsApi()).bytes(path),
      runtime.openPdf,
    ),
  );

  if (pdf.data === undefined) {
    if (!pdf.isError) return <FileMessage active={input.active} title="Opening file…" />;

    return (
      <FileMessage
        active={input.active}
        alert
        title={
          pdf.error.name === "PasswordException"
            ? "This PDF is password-protected."
            : "This PDF could not be opened."
        }
      >
        {pdf.error.name !== "PasswordException" && (
          <span {...props(viewerStyles.messageDetail)}>{pdf.error.message}</span>
        )}
        <RevealButton path={path} />
      </FileMessage>
    );
  }

  return (
    <div
      aria-hidden={!input.active}
      inert={!input.active}
      {...props(viewerStyles.root, !input.active && viewerStyles.hidden)}
    >
      <runtime.PdfViewer
        file={pdf.isPlaceholderData ? undefined : pdf.data}
        label={path.split("/").at(-1) ?? path}
      />
    </div>
  );
}
