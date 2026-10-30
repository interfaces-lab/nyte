import { publishDeferred } from "../../../lib/deferred.tsx";
import { PdfViewer } from "./pdf-viewer.tsx";
import { openPdf } from "./pdfjs.ts";

export const pdfRuntime = { openPdf, PdfViewer };

publishDeferred("pdf", pdfRuntime);
