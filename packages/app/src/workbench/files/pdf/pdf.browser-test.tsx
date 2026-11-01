import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ByteReader } from "@nyte-ai/sdk";
import "../../../theme/tokens.stylex.ts";
import { pdfQuery } from "../pdf-query.ts";
import { createPdfPages } from "./pdf-pages.ts";
import { PdfViewer } from "./pdf-viewer.tsx";
import { samplePdf } from "./pdf.fixture.ts";
import { createPdfReader } from "./pdfjs.ts";
import type { PdfFile } from "./pdfjs.ts";

declare global {
  interface Window {
    readonly pdfWorker: string;
  }
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Settles with `promise`, or with "timed out" once `ms` pass. */
function within<T>(ms: number, promise: Promise<T>): Promise<T | "timed out"> {
  return Promise.race([
    promise,
    new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), ms)),
  ]);
}

async function workerThatFailsToLoad(): Promise<void> {
  const reader = createPdfReader(new URL("missing-worker.mjs", location.href));
  const opens = [samplePdf([{}]), samplePdf([{}])].map((data) => reader.open(data, () => {}));
  const outcomes = await within(5000, Promise.allSettled(opens));

  check(
    outcomes !== "timed out" && outcomes.every((outcome) => outcome.status === "rejected"),
    `Opens on a worker that failed to load ${outcomes === "timed out" ? "never settled" : "resolved"}`,
  );
}

async function failedOpenLeavesTheQueueMoving(): Promise<void> {
  const reader = createPdfReader(new URL(window.pdfWorker));
  const corrupt = new TextEncoder().encode("%PDF-1.4\nnot a pdf");
  const opens = [corrupt, samplePdf([{}, {}])].map((data) => reader.open(data, () => {}));
  const outcomes = await within(5000, Promise.allSettled(opens));

  check(
    outcomes !== "timed out" &&
      outcomes[0].status === "rejected" &&
      outcomes[1].status === "fulfilled",
    "A corrupt PDF opened, hung, or held up the PDF after it",
  );
}

async function opensWithoutReadingLaterPages(): Promise<void> {
  const reader = createPdfReader(new URL(window.pdfWorker));
  const data = samplePdf([{ size: [300, 400] }, {}, { broken: true }]);
  const file = await within(5000, Promise.allSettled([reader.open(data, () => {})]));

  check(
    file !== "timed out" && file[0].status === "fulfilled",
    "A PDF with an unreadable third page did not open",
  );
  check(
    file[0].value.document.numPages === 3 && file[0].value.firstPage.width === 300,
    "The PDF opened with the wrong page count or first page",
  );
}

/** About half a second of drawing: tens of thousands of strokes. */
const SLOW_PAGE = Array.from(
  { length: 60_000 },
  (_, index) =>
    `${index % 600} ${(index * 7) % 780} m ${(index * 13) % 600} ${(index * 3) % 780} l S`,
).join("\n");

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** Polls `read` each frame for up to five seconds until it returns something. */
async function eventually<T>(read: () => T | undefined): Promise<T | undefined> {
  const end = performance.now() + 5000;

  while (performance.now() < end) {
    const value = read();

    if (value !== undefined) return value;
    await nextFrame();
  }

  return undefined;
}

/** Letter-sized slots in the scroller and column `createPdfPages` expects, scrolled to page `top`, from 1. */
function mountPages(file: PdfFile, pages: number, top: number) {
  const scroller = document.createElement("div");
  scroller.style.cssText = "width: 400px; height: 300px; overflow: auto";
  const column = document.createElement("div");

  const slots = Array.from({ length: pages }, () => {
    const slot = document.createElement("div");
    slot.style.cssText = "width: 100%; aspect-ratio: 612 / 792";

    return slot;
  });

  column.append(...slots);
  scroller.append(column);
  document.body.append(scroller);
  scroller.scrollTop = slots[top - 1].offsetTop;
  const failures: string[] = [];

  const teardown = createPdfPages(
    file,
    { current: undefined },
    {
      onPage: () => {},
      onSize: () => {},
      onFailure: (page, message) => {
        if (message !== undefined) failures.push(`page ${page}: ${message}`);
      },
    },
  )(column);

  return {
    slots,
    failures,
    teardown: () => {
      teardown?.();
      scroller.remove();
    },
  };
}

/** A page only arrives in a message from the worker, so a few microtasks after the queue opens, the first paint is waiting for one. */
async function teardownMidLoad(): Promise<void> {
  const reader = createPdfReader(new URL(window.pdfWorker));
  const file = await reader.open(samplePdf(Array.from({ length: 6 }, () => ({}))), () => {});
  const gate = Promise.withResolvers<void>();
  void file.enqueue(() => gate.promise);
  const pages = mountPages(file, 6, 5);
  await nextFrame();
  gate.resolve();

  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  pages.teardown();
  await file.enqueue(async () => {});

  check(
    pages.failures.length === 0,
    `Pages torn down mid-load failed: ${pages.failures.join("; ")}`,
  );
  check(
    pages.slots.every((slot) => slot.childElementCount === 0),
    "A page torn down mid-load was drawn",
  );
}

async function teardownCancelsDrawing(): Promise<void> {
  const reader = createPdfReader(new URL(window.pdfWorker));
  const file = await reader.open(samplePdf([{ content: SLOW_PAGE }]), () => {});
  const started = performance.now();
  const full = mountPages(file, 1, 1);
  await nextFrame();
  await file.enqueue(async () => {});
  const drawing = performance.now() - started;
  full.teardown();

  const pages = mountPages(file, 1, 1);
  await nextFrame();
  const tornDown = performance.now();
  pages.teardown();
  await file.enqueue(async () => {});
  const waited = performance.now() - tornDown;

  check(
    waited < drawing / 4,
    `Teardown waited ${Math.round(waited)} ms for a draw that takes ${Math.round(drawing)} ms`,
  );
  check(pages.failures.length === 0, `A cancelled draw failed: ${pages.failures.join("; ")}`);
}

async function failedPageShowsAnError(): Promise<void> {
  const reader = createPdfReader(new URL(window.pdfWorker));
  const file = await reader.open(samplePdf([{}, { broken: true }, {}]), () => {});
  const host = document.createElement("div");
  host.style.cssText = "display: flex; width: 500px; height: 700px";
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(<PdfViewer file={file} label="sample.pdf" />));

  const failed = await eventually(() =>
    host.querySelector('[aria-label^="Page 2:"]')?.textContent?.includes("could not be drawn")
      ? true
      : undefined,
  );

  const drawn = host.querySelector('[aria-label="Page 1"] canvas');
  root.unmount();
  host.remove();

  check(failed === true, "A page that could not be drawn showed no error");
  check(drawn !== null, "The page before a broken one was not drawn");
}

function byteReader(data: Uint8Array<ArrayBuffer>): ByteReader {
  return {
    size: data.length,
    mime: "application/pdf",
    async *chunks() {
      yield data;
    },
    close: async () => {},
    [Symbol.asyncDispose]: async () => {},
  };
}

async function newVersionClosesTheOld(): Promise<void> {
  const reader = createPdfReader(new URL(window.pdfWorker));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const gate = Promise.withResolvers<void>();

  const read = (version: string) =>
    pdfQuery(
      "report.pdf",
      version,
      async () => {
        if (version === "2") await gate.promise;

        return byteReader(samplePdf([{}, {}]));
      },
      reader.open,
    );

  const observer = new QueryObserver(client, read("1"));
  const unsubscribe = observer.subscribe(() => {});
  const first = await eventually(() => observer.getCurrentResult().data);
  observer.setOptions(read("2"));
  const opening = observer.getCurrentResult();
  gate.resolve();
  const closed = await eventually(() => (first?.document.loadingTask.destroyed ? true : undefined));
  unsubscribe();
  client.clear();

  check(first !== undefined, "The first version never opened");
  check(
    opening.isPlaceholderData && opening.data === first,
    "While the next version opened, the viewer had no document to stay mounted on",
  );
  check(closed === true, "The previous version's document stayed open");
}

async function newVersionKeepsZoomAndPage(): Promise<void> {
  const reader = createPdfReader(new URL(window.pdfWorker));
  const pages = Array.from({ length: 5 }, () => ({}));
  const first = await reader.open(samplePdf(pages), () => {});
  const second = await reader.open(samplePdf(pages), () => {});
  const host = document.createElement("div");
  host.style.cssText = "display: flex; width: 500px; height: 700px";
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(<PdfViewer file={first} label="report.pdf" />));
  const zoomIn = host.querySelector('[aria-label="Zoom in"]');
  check(zoomIn instanceof HTMLElement, "The viewer has no zoom control");
  flushSync(() => zoomIn.click());
  await nextFrame();
  const scroller = host.querySelector('[role="region"]');
  const target = host.querySelector('[aria-label="Page 3"]');
  check(scroller !== null && target instanceof HTMLElement, "The viewer has no third page");
  scroller.scrollTop = target.offsetTop;
  await eventually(() => (host.textContent?.includes("Page 3 of 5") ? true : undefined));

  flushSync(() => root.render(<PdfViewer file={undefined} label="report.pdf" />));
  await nextFrame();
  flushSync(() => root.render(<PdfViewer file={second} label="report.pdf" />));
  await nextFrame();
  await nextFrame();
  const page = host.querySelector('[aria-label="Page 3"]');
  const status = host.textContent ?? "";

  const offset =
    page === null
      ? Infinity
      : page.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

  root.unmount();
  host.remove();

  check(status.includes("125%"), `The next version reset the zoom: ${status}`);
  check(status.includes("Page 3 of 5"), `The next version moved off page 3: ${status}`);
  check(Math.abs(offset) < 40, `The next version put page 3 ${Math.round(offset)} px from the top`);
}

export async function run(): Promise<string> {
  await workerThatFailsToLoad();
  await failedOpenLeavesTheQueueMoving();
  await opensWithoutReadingLaterPages();
  await failedPageShowsAnError();
  await teardownMidLoad();
  await teardownCancelsDrawing();
  await newVersionClosesTheOld();
  await newVersionKeepsZoomAndPage();

  return "passed";
}
