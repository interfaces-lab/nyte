import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { runBrowserHarness } from "./fixtures/browser-harness.ts";

const PAGE_ONE = `<!doctype html><meta charset="utf-8"><title>page one</title>
<body style="font:16px system-ui;margin:0">
<button id="alpha" style="position:absolute;left:40px;top:40px;width:180px;height:40px">Alpha Button</button>
<form id="f" style="position:absolute;left:40px;top:100px">
  <input id="q" name="q" aria-label="Search query" style="width:260px;height:32px">
</form>
<script>
  window.__clicked = "";
  document.addEventListener("click", (e) => { window.__clicked = e.target.id || e.target.tagName; }, true);
  document.getElementById("f").addEventListener("submit", (e) => {
    e.preventDefault();
    window.__submitted = document.getElementById("q").value;
  });
</script>
`;

const AUTOFOCUS_PAGE = `<!doctype html><title>autofocus</title><input id="q" autofocus>`;

const SCRIPT_FOCUS_PAGE = `<!doctype html><title>script focus</title><input id="q">
<script>
  document.getElementById("q").focus();
  window.__focused = document.activeElement.id;
</script>`;

const LATER_FOCUS_PAGE = `<!doctype html><title>later</title>
<button id="later" style="width:180px;height:40px">Focus Later</button><input id="q">
<script>
  document.getElementById("later").addEventListener("click", () =>
    setTimeout(() => {
      document.getElementById("q").focus();
      window.__focused = document.activeElement.id;
    }, 400));
</script>`;

const PAGE_TWO = `<!doctype html><meta charset="utf-8"><title>page two</title>
<body style="font:16px system-ui;margin:0">
<button id="gamma" style="position:absolute;left:40px;top:40px;width:180px;height:40px">Gamma Button</button>
<script>
  window.__clicked = "";
  document.addEventListener("click", (e) => { window.__clicked = e.target.id || e.target.tagName; }, true);
</script>
`;

const SCRIPT = `
  const rt = require("./runtime.cjs");
  const pages = {
    one: fs.readFileSync(dir + "/page1.html"),
    two: fs.readFileSync(dir + "/page2.html"),
    autofocus: fs.readFileSync(dir + "/autofocus.html"),
    focus: fs.readFileSync(dir + "/focus.html"),
    later: fs.readFileSync(dir + "/later.html"),
  };
  const server = await serve((path) => pages[path.slice(1)] ?? pages.one);
  const base = server.url;
  const context = browser();
  const host = await context.guestWindow({ show: true });
  context.surfaces.open({ surface: "runtime", url: base + "/one", holder: "tab" }, host.id);
  await host.show("runtime", { x: 0, y: 0, width: 900, height: 600 });
  const wc = await context.attached("runtime");
  await until(() => !wc.isLoading() && wc.getURL() === base + "/one");
  const key = await focusWindow(host.window);
  await host.focusComposer();
  const focus = [];
  const keyboard = async (step) =>
    focus.push([step, await host.page("document.activeElement.id || document.activeElement.tagName"), wc.focusedFrame !== null]);
  await keyboard("start");

  const runtime = rt.createSurfaceRuntime();

  const first = await rt.takeSnapshot(wc, runtime);
  const button = first.nodes.find((n) => n.name === "Alpha Button");
  const clicked = await rt.performClick(wc, runtime, button.ref, "left", false, true);
  const clickTarget = await wc.executeJavaScript("window.__clicked");
  await keyboard("click");

  const typing = await rt.takeSnapshot(wc, runtime);
  const field = typing.nodes.find((n) => n.editable === true);
  const typed = await rt.performType(wc, runtime, field.ref, "hello world", false, true, true);
  const fieldValue = await wc.executeJavaScript("document.getElementById('q').value");
  const submitted = await wc.executeJavaScript("window.__submitted || null");
  await keyboard("type");
  await rt.performPress(wc, runtime, "Tab", undefined, true);
  await keyboard("press");

  const pressed = async () =>
    (await host.messages()).filter(([, channel]) => channel === "nyte:browser-page-press").length;
  const agentPresses = await pressed();
  const alpha = (await rt.takeSnapshot(wc, runtime)).nodes.find((n) => n.name === "Alpha Button");
  await wc.executeJavaScript("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true");
  await rt.performClick(wc, runtime, alpha.ref, "left", false, true);
  await until(async () => (await pressed()) > agentPresses);
  const forgedPresses = (await pressed()) - agentPresses - 1;

  const staleRef = (await rt.takeSnapshot(wc, runtime)).nodes.find((n) => n.name === "Alpha Button").ref;
  await wc.loadURL(base + "/two");
  const stale = await rt.performClick(wc, runtime, staleRef, "left", false, true);
  const staleTarget = await wc.executeJavaScript("window.__clicked");

  const reinjected = await rt.takeSnapshot(wc, runtime);
  const gamma = reinjected.nodes.find((n) => n.name === "Gamma Button");
  const freshClick = await rt.performClick(wc, runtime, gamma.ref, "left", false, true);
  const freshTarget = await wc.executeJavaScript("window.__clicked");

  const shot = await rt.performCapture(wc);

  for (const step of ["autofocus", "focus"]) {
    await host.focusComposer();
    await wc.loadURL(base + "/" + step);
    await until(() => host.page("document.activeElement.tagName === 'WEBVIEW'"), 20);
    await keyboard(step + " on load");
  }

  const focusedOnLoad = await wc.executeJavaScript("window.__focused ?? null");

  await host.focusComposer();
  await wc.loadURL(base + "/later");
  const later = (await rt.takeSnapshot(wc, runtime)).nodes.find((n) => n.name === "Focus Later");
  await rt.performClick(wc, runtime, later.ref, "left", false, true);
  await keyboard("after the agent's press");
  await until(() => wc.executeJavaScript("window.__focused === 'q'"));
  await until(() => host.page("document.activeElement.tagName === 'WEBVIEW'"), 20);
  await keyboard("focus after activation");
  const focusedLater = await wc.executeJavaScript("window.__focused ?? null");

  report({
    key,
    refs: first.nodes.length,
    clickKind: clicked.kind,
    clickTarget,
    typeKind: typed.kind,
    fieldValue,
    submitted,
    staleFailure: stale.kind === "failed" ? stale.failure.kind : "acted:" + stale.kind,
    staleTarget,
    freshKind: freshClick.kind,
    freshTarget,
    captureBytes: shot ? shot.length : 0,
    focus,
    agentPresses,
    forgedPresses,
    pageFocused: [focusedOnLoad, focusedLater],
  });
  server.close();
`;

test.runIf(process.env["NYTE_DESKTOP_BROWSER_E2E"] === "1")(
  "the browser runtime snapshots, clicks, types and presses in a guest without taking the app's keyboard, and invalidates refs across a navigation",
  async () => {
    const report: unknown = JSON.parse(
      await runBrowserHarness({
        script: SCRIPT,
        files: {
          "page1.html": PAGE_ONE,
          "page2.html": PAGE_TWO,
          "autofocus.html": AUTOFOCUS_PAGE,
          "focus.html": SCRIPT_FOCUS_PAGE,
          "later.html": LATER_FOCUS_PAGE,
        },
      }),
    );

    expect(report).toMatchObject({
      key: true,
      focus: [
        ["start", "composer", false],
        ["click", "composer", false],
        ["type", "composer", false],
        ["press", "composer", false],
        ["autofocus on load", "composer", false],
        ["focus on load", "composer", false],
        ["after the agent's press", "composer", false],
        ["focus after activation", "composer", false],
      ],
      pageFocused: ["q", "q"],
      agentPresses: 2,
      forgedPresses: 0,
      clickKind: "ok",
      clickTarget: "alpha",
      typeKind: "ok",
      fieldValue: "hello world",
      submitted: "hello world",
      staleTarget: "",
      freshKind: "ok",
      freshTarget: "gamma",
    });
    expect(report).toHaveProperty(
      "staleFailure",
      expect.stringMatching(/unknown_ref|stale_document|detached/),
    );

    const bytes = Value.Parse(
      Type.Object({ refs: Type.Number(), captureBytes: Type.Number() }),
      report,
    );

    expect(bytes.refs).toBeGreaterThan(0);
    expect(bytes.captureBytes).toBeGreaterThan(1000);
  },
  120_000,
);
