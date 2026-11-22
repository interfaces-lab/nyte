import { getDocument, PDFWorker } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PageSize {
  readonly width: number;
  readonly height: number;
}

export interface PdfFile {
  readonly document: PDFDocumentProxy;
  readonly firstPage: PageSize;
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>;
}

export interface PdfReader {
  readonly open: (
    data: Uint8Array<ArrayBuffer>,
    hold: (close: () => void) => void,
  ) => Promise<PdfFile>;
}

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

      const first = (await enqueue(() => document.getPage(1))).getViewport({ scale: 1 });

      return { document, firstPage: { width: first.width, height: first.height }, enqueue };
    },
  };
}
