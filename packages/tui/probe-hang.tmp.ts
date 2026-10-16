import { appendFileSync, writeFileSync } from "node:fs";
import { CliRenderer, getTreeSitterClient } from "@opentui/core";
const LOG = "/tmp/nyte-rc/probe.log";
writeFileSync(LOG, "");
const t0 = performance.now();
const log = (s: string) => appendFileSync(LOG, `${(performance.now() - t0).toFixed(0).padStart(6)} ${s}\n`);
let renderer: CliRenderer | undefined;
const idle = CliRenderer.prototype.idle;
CliRenderer.prototype.idle = function (this: CliRenderer) {
  renderer = this;
  log("idle() called " + JSON.stringify(this.getSchedulerState()));
  const p = idle.call(this);
  void p.then(() => log("idle resolved"));
  return p;
};
setInterval(() => { if (renderer) log("state " + JSON.stringify(renderer.getSchedulerState())); }, 1000).unref();
if (process.env.WARM) { getTreeSitterClient(); log("client created"); }
import { CodeRenderable } from "@opentui/core";
const sh = CodeRenderable.prototype.startHighlight;
let n = 0;
CodeRenderable.prototype.startHighlight = async function (this: CodeRenderable) { const b = performance.now(); const k = ++n; if (k === 1) log("first highlight start"); try { return await sh.call(this); } finally { if (k === 1) log(`first highlight done ${(performance.now() - b).toFixed(0)}ms`); } };
if (process.env.WARM === "2" || process.env.WARM === "3") {
  const c = getTreeSitterClient();
  void c.initialize().then(() => log("initialized"), (e) => log("init failed " + e));
  if (process.env.WARM === "3") void c.initialize().then(() => c.preloadParser("markdown")).then((p) => log("preloaded " + p), (e) => log("preload failed " + e));
}
