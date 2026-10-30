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

/** The worker starts with the first open. Once it fails, every queued and later task rejects. */
export function createPdfReader(workerUrl: URL): PdfReader {
  let worker: PDFWorker | undefined;
  let failure: Error | undefined;
  const running = new Set<(error: Error) => void>();
  let tail: Promise<unknown> = Promise.resolve();

  const start = (): PDFWorker => {
    if (worker !== undefined) return worker;
    const port = new Worker(workerUrl, { type: "module", name: "pdf.js" });

    port.addEventListener("error", (event) => {
      failure = new Error(
        event instanceof ErrorEvent && event.message !== ""
          ? event.message
          : "The PDF reader could not start.",
      );

      for (const reject of running) reject(failure);
    });
    worker = PDFWorker.create({ port });

    return worker;
  };

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(
      () =>
        new Promise<T>((resolve, reject) => {
          if (failure !== undefined) {
            reject(failure);

            return;
          }

          const pending = task();
          running.add(reject);
          void pending.then(resolve, reject).finally(() => running.delete(reject));
        }),
    );

    tail = Promise.allSettled([run]);

    return run;
  };

  return {
    open: async (data, hold) => {
      const document = await enqueue(async () => {
        const task = getDocument({
          data,
          worker: start(),
          isEvalSupported: false,
          disableAutoFetch: true,
        });

        const [opened] = await Promise.allSettled([task.promise]);

        if (opened.status === "fulfilled") return opened.value;
        await task.destroy();

        throw opened.reason;
      });

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
