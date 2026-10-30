import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** Vite resolves the package path and ships the worker as an asset, unbundled. */
const WORKER_URL = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);

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
}

let tail: Promise<unknown> = Promise.resolve();

/** Runs `task` on the shared pdf.js worker once every task before it settles, so the worker opens, draws or closes one thing at a time. */
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task);
  tail = Promise.allSettled([run]);

  return run;
}

/**
 * Opens a PDF on the shared worker and measures its pages. `hold` receives the document's
 * close as soon as it is open, so a document whose pages can't be read still closes.
 */
export async function openPdf(
  data: Uint8Array<ArrayBuffer>,
  hold: (close: () => void) => void,
): Promise<PdfFile> {
  GlobalWorkerOptions.workerPort ??= new Worker(WORKER_URL, { type: "module", name: "pdf.js" });

  const document = await enqueue(
    () => getDocument({ data, isEvalSupported: false, disableAutoFetch: true }).promise,
  );

  hold(() => void enqueue(() => document.destroy()));

  const pages = await Promise.all(
    Array.from({ length: document.numPages }, async (_, index) => {
      const viewport = (await document.getPage(index + 1)).getViewport({ scale: 1 });

      return { number: index + 1, width: viewport.width, height: viewport.height };
    }),
  );

  return { document, pages };
}
