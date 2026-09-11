const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.FORCE_COLOR !== "0" &&
  (process.stdout.isTTY === true || process.env.FORCE_COLOR !== undefined);

const ESC = "[";
const paint = (open, close) => (text) => (useColor ? `${ESC}${open}m${text}${ESC}${close}m` : text);
export const bold = paint(1, 22);
export const dim = paint(2, 22);
export const red = paint(31, 39);
export const green = paint(32, 39);

const control = (body) => new RegExp(`${ESC[0]}\\[${body}`, "g");
const SGR = control("[0-9;]*m");
const KIB = 1_024;
export function formatSize(bytes) {
  return `${(bytes / KIB).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KiB`;
}

export function formatBytes(bytes) {
  if (bytes < KIB * KIB) return `${(bytes / KIB).toFixed(1)} KiB`;
  return `${(bytes / KIB / KIB).toFixed(1)} MiB`;
}

export function formatDuration(ms) {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms - minutes * 60_000) / 1_000)}s`;
}

const visibleLength = (cell) => cell.replace(SGR, "").length;

export function table(rows, { align = [] } = {}) {
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, visibleLength(cell));
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, index) => {
          const pad = " ".repeat(widths[index] - visibleLength(cell));
          return align[index] === "right" ? pad + cell : cell + pad;
        })
        .join("  ")
        .trimEnd(),
    )
    .map((line) => `  ${line}\n`)
    .join("");
}

export function success(message) {
  process.stdout.write(`${green("✓")} ${message}\n`);
}

export function failure(message) {
  process.stderr.write(`${red("✗")} ${message}\n`);
}

export function heading(step, message) {
  process.stdout.write(`\n${dim(step)} ${bold(message)}\n`);
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ANSI = control("[0-9;?]*[A-Za-z]");

// Splits a child's chunks into complete lines, dropping colors and
// carriage-return progress rewrites.
function lineReader(onLine) {
  let partial = "";
  return {
    push(chunk) {
      const parts = (partial + chunk).replace(ANSI, "").split("\n");
      partial = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.slice(part.lastIndexOf("\r") + 1).trimEnd();
        if (line !== "") onLine(line);
      }
      partial = partial.slice(partial.lastIndexOf("\r") + 1);
    },
    get partial() {
      return partial;
    },
  };
}

const fit = (line, reserve) => line.slice(0, (process.stdout.columns || 100) - reserve);

// Spinner, elapsed time, and the last `max` lines of a child's output, redrawn
// in place. `stop` erases it; `output` holds everything for failure reports.
export function livePanel({ max = 6 } = {}) {
  const started = performance.now();
  const lines = [];
  let output = "";
  let printed = 0;
  let frame = 0;
  let rendered = 0;
  const reader = lineReader((line) => {
    lines.push(line);
    if (lines.length > max) lines.splice(0, lines.length - max);
  });

  const render = () => {
    const tail = [...lines, ...(reader.partial === "" ? [] : [reader.partial])].slice(-max);
    const block = [
      `  ${FRAMES[frame++ % FRAMES.length]} ${dim(formatDuration(performance.now() - started))}`,
      ...tail.map((line) => `  ${dim(`│ ${fit(line, 4)}`)}`),
    ];
    process.stdout.write(`${erase()}${block.join("\n")}\n`);
    printed = block.length;
    rendered = performance.now();
  };
  const erase = () => (printed === 0 ? "" : `\u001b[${printed}A\u001b[J`);
  const showCursor = () => process.stdout.write("\u001b[?25h");

  process.stdout.write("\u001b[?25l");
  process.once("exit", showCursor);
  const timer = setInterval(render, 100);
  render();

  return {
    push(chunk) {
      output += chunk;
      reader.push(chunk);
      if (performance.now() - rendered > 40) render();
    },
    stop() {
      clearInterval(timer);
      process.stdout.write(erase());
      printed = 0;
      process.removeListener("exit", showCursor);
      showCursor();
      return output;
    },
  };
}

// The same tail for hosts that prefix every line and ignore cursor movement,
// such as Turbo's stream output: the latest line, at most one per `every` ms.
export function lineLog({ every = 750 } = {}) {
  const started = performance.now();
  let output = "";
  let latest = "";
  let shown = "";
  let timer;
  const reader = lineReader((line) => {
    latest = line;
  });
  const emit = () => {
    timer = undefined;
    if (latest === shown) return;
    shown = latest;
    process.stdout.write(
      `  ${dim(formatDuration(performance.now() - started).padStart(6))} │ ${fit(latest, 40)}\n`,
    );
  };
  return {
    push(chunk) {
      output += chunk;
      reader.push(chunk);
      timer ??= setTimeout(emit, every);
    },
    stop() {
      clearTimeout(timer);
      emit();
      return output;
    },
  };
}
