import { publishDeferred } from "../../../lib/deferred.tsx";
import { PdfViewer } from "./pdf-viewer.tsx";
import { createPdfReader } from "./pdfjs.ts";

/** Vite resolves the package path and ships the worker as an asset, unbundled. */
const WORKER_URL = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);

export const pdfRuntime = { openPdf: createPdfReader(WORKER_URL).open, PdfViewer };

publishDeferred("pdf", pdfRuntime);
