/*
 * Scene two from the design record, rendered as the log a runner would leave
 * behind. A run is killed after a tool intent but before its result. Another
 * process acquires the expired lease, replays the `safe` effect, and carries
 * on from refs. The client watching sees a pause and nothing else.
 *
 * Intent rows are magenta: a promise made, not yet true. Result and publish
 * rows are mint: durable, fenced, done. The cut in the middle is where the
 * first process died.
 */
type Kind = "lease" | "commit" | "intent" | "replay" | "result" | "publish";

interface Row {
  step: string;
  kind: Kind;
  subject: string;
  detail: string;
  fence: string;
}

const before: Row[] = [
  {
    step: "01",
    kind: "lease",
    subject: "runner a",
    detail: "acquired refs/heads/main",
    fence: "f1",
  },
  {
    step: "02",
    kind: "commit",
    subject: "user",
    detail: "“rename the config loader”",
    fence: "f1",
  },
  {
    step: "03",
    kind: "intent",
    subject: "fs.write",
    detail: "effect e7 · replay: safe",
    fence: "f1",
  },
];

const after: Row[] = [
  { step: "04", kind: "lease", subject: "runner b", detail: "expired lease acquired", fence: "f2" },
  {
    step: "05",
    kind: "replay",
    subject: "fs.write",
    detail: "e7 is safe → run again",
    fence: "f2",
  },
  { step: "06", kind: "result", subject: "fs.write", detail: "ok · 3 files", fence: "f2" },
  { step: "07", kind: "commit", subject: "assistant", detail: "streaming, index 0…", fence: "f2" },
  {
    step: "08",
    kind: "publish",
    subject: "refs/heads/main",
    detail: "fence f2 checked, moved",
    fence: "f2",
  },
];

const tone: Record<Kind, string> = {
  lease: "text-cut-dim",
  commit: "text-cut-ink",
  intent: "text-cut-intent",
  replay: "text-cut-dim",
  result: "text-cut-result",
  publish: "text-cut-result",
};

function LogRow({ row }: { row: Row }) {
  return (
    <li className="grid grid-cols-[2ch_7ch_1fr_2.5ch] items-baseline gap-x-3 px-4 py-2 text-[0.8125rem] leading-5 sm:grid-cols-[2ch_7ch_11ch_1fr_2.5ch]">
      <span className="text-cut-faint">{row.step}</span>
      <span className={tone[row.kind]}>{row.kind}</span>
      <span className="hidden truncate text-cut-ink sm:block">{row.subject}</span>
      <span className="truncate text-cut-dim">
        <span className="text-cut-ink sm:hidden">{row.subject} </span>
        {row.detail}
      </span>
      <span className="text-right text-cut-faint">{row.fence}</span>
    </li>
  );
}

export function StepLog() {
  return (
    <figure className="cut-mono border border-cut-rule-strong bg-cut-panel">
      <figcaption className="flex items-center justify-between border-b border-cut-rule px-4 py-2.5">
        <span className="cut-label text-cut-dim">session · main · steps</span>
        <span className="flex items-center gap-1.5 text-[0.6875rem] text-cut-dim">
          <span className="size-1.5 rounded-full bg-cut-result" aria-hidden="true" />
          live
        </span>
      </figcaption>

      <ol className="divide-y divide-cut-rule py-1">
        {before.map((row) => (
          <LogRow key={row.step} row={row} />
        ))}
      </ol>

      <div
        role="separator"
        aria-label="process killed"
        className="relative flex items-center gap-3 px-4 py-2 text-[0.6875rem] tracking-[0.12em] text-cut-intent uppercase"
      >
        <span className="h-px flex-1 bg-cut-intent/40" />
        process killed
        <span className="h-px flex-1 bg-cut-intent/40" />
      </div>

      <ol className="divide-y divide-cut-rule py-1">
        {after.map((row) => (
          <LogRow key={row.step} row={row} />
        ))}
      </ol>

      <p className="border-t border-cut-rule px-4 py-2.5 text-[0.6875rem] leading-4 text-cut-faint">
        The client watching sees a pause and nothing else.
      </p>
    </figure>
  );
}
