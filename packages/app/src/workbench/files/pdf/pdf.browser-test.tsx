import { samplePdf } from "./pdf.fixture.ts";
import { createPdfReader } from "./pdfjs.ts";

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

export async function run(): Promise<string> {
  await workerThatFailsToLoad();
  await failedOpenLeavesTheQueueMoving();
  await opensWithoutReadingLaterPages();

  return "passed";
}
