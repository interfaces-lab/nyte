import { getDocument, PDFWorker } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PageSize {
  /** From 1. */
  readonly number: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfFile {
  readonly document: PDFDocumentProxy;
  /** Each page's size at scale 1, in PDF units, after its rotation. */
  readonly pages: readonly PageSize[];
  /** Runs `task` on the reader's worker once every task before it settles, so the worker opens, draws or closes one thing at a time. */
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>;
}

export interface PdfReader {
  /** `hold` receives the document's close as soon as it is open, so a document whose pages can't be read still closes. */
  readonly open: (
    data: Uint8Array<ArrayBuffer>,
    hold: (close: () => void) => void,
  ) => Promise<PdfFile>;
}

/** The worker starts with the first open. */
export function createPdfReader(workerUrl: URL): PdfReader {
  let worker: PDFWorker | undefined;
  let tail: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = Promise.allSettled([run]);

    return run;
  };

  return {
    open: async (data, hold) => {
      const port = (worker ??= PDFWorker.create({
        port: new Worker(workerUrl, { type: "module", name: "pdf.js" }),
      }));

      const document = await enqueue(
        () =>
          getDocument({ data, worker: port, isEvalSupported: false, disableAutoFetch: true })
            .promise,
      );

      hold(() => void enqueue(() => document.destroy()));

      const pages = await Promise.all(
        Array.from({ length: document.numPages }, async (_, index) => {
          const viewport = (await document.getPage(index + 1)).getViewport({ scale: 1 });

          return { number: index + 1, width: viewport.width, height: viewport.height };
        }),
      );

      return { document, pages, enqueue };
    },
  };
}
