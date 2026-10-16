import { appendFileSync, writeFileSync } from "node:fs";
import { CodeRenderable, getTreeSitterClient } from "@opentui/core";
const LOG = "/tmp/nyte-rc/probe.log";
writeFileSync(LOG, "");
const t0 = performance.now();
const now = () => (performance.now() - t0).toFixed(0).padStart(6);
const log = (s: string) => appendFileSync(LOG, `${now()} ${s}\n`);
const c = getTreeSitterClient();
if (process.env.WARM) void c.initialize().then(() => c.preloadParser("markdown")).then(() => log("warm"));
const hwm = c.handleWorkerMessage.bind(c);
let responses = 0;
c.handleWorkerMessage = (event: MessageEvent) => {
  if (event.data?.type === "ONESHOT_HIGHLIGHT_RESPONSE") { responses++; if (responses <= 2 || responses % 25 === 0) log(`response #${responses} arrives`); }
  return hwm(event);
};
const sh = CodeRenderable.prototype.startHighlight;
let n = 0, done = 0;
CodeRenderable.prototype.startHighlight = async function (this: CodeRenderable) {
  const k = ++n; if (k <= 2 || k % 25 === 0) log(`highlight #${k} start ${this.filetype} len=${this.content.length}`);
  try { return await sh.call(this); } finally { done++; if (done <= 2 || done % 25 === 0) log(`highlight done count=${done}`); }
};
let last = performance.now();
setInterval(() => { const t = performance.now(); if (t - last > 40) log(`main blocked ${(t - last).toFixed(0)}ms (ending now)`); last = t; }, 5).unref();
if (process.env.PROBE_EXIT) setTimeout(() => process.exit(0), Number(process.env.PROBE_EXIT));
