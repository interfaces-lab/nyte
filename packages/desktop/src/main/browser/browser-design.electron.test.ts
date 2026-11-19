import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import { runBrowserHarness } from "./fixtures/browser-harness.ts";

const PAGE = `<!doctype html><meta charset="utf-8"><title>design</title>
<body style="font:16px system-ui;margin:0">
<main style="padding:40px">
  <button class="primary" style="width:160px;height:40px;margin:0">Save</button><button class="primary" style="width:160px;height:40px;margin:0">Cancel</button>
  <p><input id="field"></p>
</main>
<dialog style="margin:0;inset:auto auto 40px 40px"><button id="confirm" style="width:120px;height:32px">Confirm</button><input id="inner"><iframe srcdoc="<button id=deep onclick=parent.__deep=true style=width:180px;height:40px>Deep</button>" style="width:200px;height:60px"></iframe></dialog>
<script>
  window.__seen = [];
  window.__confirmed = false;
  window.__deep = false;
  document.querySelector("#confirm").addEventListener("click", () => (window.__confirmed = true));
  for (const type of ["pointerdown", "pointermove", "mousedown", "click", "keydown", "keyup"])
    window.addEventListener(type, (event) => window.__seen.push(event.type + (event.isTrusted ? "" : ":forged")), true);
</script>
`;

const SCRIPT = `
  const pages = await serve(() => fs.readFileSync(dir + "/page.html"));
  const url = pages.url + "/";
  const context = browser();
  const host = await context.guestWindow({ show: true, width: 600, height: 400 });
  await focusWindow(host.window);
  const surface = "design";
  context.surfaces.open({ surface, url, holder: "tab" }, host.id);
  await host.show(surface, { x: 0, y: 0, width: 600, height: 400 });
  await host.focus(surface);
  const wc = await context.attached(surface);
  await until(() => !wc.isLoading() && wc.getURL() === url);
  const children = () => wc.executeJavaScript("document.documentElement.children.length");
  const before = await children();

  const posted = () => context.events.map(({ event }) => event);
  const picks = () => posted().filter((event) => event.kind === "browser_design_pick");
  const designs = () => posted().filter((event) => event.kind === "browser_changed").map((event) => event.state.design);
  const click = (x, y) => {
    wc.sendInputEvent({ type: "mouseMove", x, y });
    wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  };

  const stroke = (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    wc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  const opacity = () =>
    wc.executeJavaScript("getComputedStyle(document.documentElement.lastElementChild).opacity");
  const ringInCrop = (dataUrl) => {
    const image = nativeImage.createFromDataURL(dataUrl);
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const at = Math.floor(size.height / 2) * size.width * 4;
    return Math.abs(bitmap[at] - bitmap[at + 2]) > 150;
  };

  await wc.executeJavaScript('document.querySelector("#field").focus(); true');
  context.surfaces.design({ surface, change: { kind: "on" } });
  await until(async () => (await children()) > before);
  const during = await children();

  click(100, 60);
  stroke("X", ["shift"]);
  await until(() => picks().length === 1);
  const element = picks()[0]?.pick;
  await until(() => designs().some((design) => design.views.xray));
  const field = await wc.executeJavaScript('document.querySelector("#field").value');

  wc.sendInputEvent({ type: "mouseMove", x: 30, y: 120 });
  wc.sendInputEvent({ type: "mouseDown", x: 30, y: 120, button: "left", clickCount: 1 });
  for (let step = 1; step <= 5; step++)
    wc.sendInputEvent({ type: "mouseMove", x: 30 + step * 60, y: 120 + step * 36, button: "left", modifiers: ["leftButtonDown"] });
  wc.sendInputEvent({ type: "mouseUp", x: 330, y: 300, button: "left", clickCount: 1 });
  await until(() => picks().length === 2);
  const area = picks()[1]?.pick;

  await wc.executeJavaScript(
    'const host = document.documentElement.lastElementChild;' +
      'host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 60, button: 0 }));' +
      'host.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 100, clientY: 60, button: 0 })); true',
  );
  await sleep(300);
  const forgedPicks = picks().length - 2;

  await until(async () => (await opacity()) === "1");
  const shown = await opacity();
  const seen = await wc.executeJavaScript("window.__seen");
  stroke("Escape");
  await until(() => designs().at(-1)?.on === false);
  await until(async () => (await children()) === before);
  const after = await children();
  const seenAfter = await wc.executeJavaScript("window.__seen");

  await wc.executeJavaScript(
    'document.querySelector("dialog").showModal(); document.querySelector("#inner").focus(); true',
  );
  const confirm = await wc.executeJavaScript(
    'JSON.parse(JSON.stringify(document.querySelector("#confirm").getBoundingClientRect()))',
  );
  context.surfaces.design({ surface, change: { kind: "on" } });
  await until(async () => (await children()) > before);
  click(confirm.x + 20, confirm.y + 10);
  await until(() => picks().length === 3);
  const modal = picks()[2]?.pick;
  const confirmed = await wc.executeJavaScript("window.__confirmed");
  await until(async () => (await opacity()) === "1");
  const frame = await wc.executeJavaScript(
    'JSON.parse(JSON.stringify(document.querySelector("iframe").getBoundingClientRect()))',
  );
  click(frame.x + 40, frame.y + 20);
  await until(() => picks().length === 4);
  const framed = picks()[3]?.pick;
  const deep = await wc.executeJavaScript("window.__deep");
  const views = designs().length;
  stroke("X", ["shift"]);
  await until(() => designs().length > views);
  const inner = await wc.executeJavaScript('document.querySelector("#inner").value');

  report({
    before,
    during,
    after,
    element: element && { ...element, image: element.image ? element.image.length : 0 },
    ring: element?.image ? ringInCrop(element.image) : undefined,
    field,
    shown,
    modal: modal?.source.selector,
    confirmed,
    framed: framed?.source.selector,
    deep,
    inner,
    modalXray: designs().at(-1)?.views.xray,
    area: area && { source: area.source, image: area.image ? area.image.slice(0, 22) : undefined },
    forgedPicks,
    designs: designs(),
    seen,
    seenAfter: seenAfter.filter((entry) => entry.startsWith("key")),
  });
  pages.close();
`;

test.runIf(process.env["NYTE_DESKTOP_BROWSER_E2E"] === "1")(
  "Design Mode picks an element and an area with their crops, takes its keys, and keeps the page from seeing any of it",
  async () => {
    const report: unknown = JSON.parse(
      await runBrowserHarness({ script: SCRIPT, files: { "page.html": PAGE } }),
    );

    expect(report).toMatchObject({
      during: 3,
      ring: false,
      field: "",
      shown: "1",
      modal: "#confirm",
      confirmed: false,
      framed: expect.stringContaining("iframe"),
      deep: false,
      inner: "",
      modalXray: false,
      seenAfter: [],
      element: {
        source: { kind: "browser", selector: "button.primary:nth-of-type(1)" },
        text: expect.stringMatching(
          /^label: button \.primary\ntext: Save\nbounds: x=40 y=40 w=160 h=40\n/,
        ),
      },
      area: {
        source: { kind: "browser", region: { x: 30, y: 120, width: 300, height: 180 } },
        image: "data:image/png;base64,",
      },
      forgedPicks: 0,
      seen: ["pointerdown:forged"],
    });

    const parsed = Value.Parse(
      Type.Object({
        before: Type.Number(),
        after: Type.Number(),
        element: Type.Object({ image: Type.Number() }),
        designs: Type.Array(
          Type.Object({ on: Type.Boolean(), views: Type.Object({ xray: Type.Boolean() }) }),
        ),
      }),
      report,
    );

    expect(parsed.element.image).toBeGreaterThan(100);
    expect(parsed.after).toBe(parsed.before);
    expect(parsed.designs.filter((design) => !design.on).at(-1)?.views.xray).toBe(true);
  },
  120_000,
);
