import { _electron } from "@playwright/test";
import electronExecutable from "electron";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sdk } from "@nyte-ai/sdk";
import { localProvider, sqliteStore } from "@nyte-ai/host";
import { fakeModels } from "@nyte-ai/host/bench";

const root = await mkdtemp(join(tmpdir(), "nyte-polish-probe-"));
const home = join(root, "home");
const appData = join(root, "app-data");
await mkdir(join(home, ".nyte"), { recursive: true });
await mkdir(appData);
const fake = fakeModels({ fallback: { content: [{ type: "text", text: "Fallback reply." }] } });
const host = await sdk.open({
  store: sqliteStore({ path: join(home, ".nyte", "nyte.db") }),
  plugins: [{ id: "local", environment: localProvider({ home }) }],
  workspace: { kind: "local", path: home },
  home,
  models: fake.models,
});
const turns = Number(process.env.PROBE_TURNS ?? 24);
const titles = ["Probe one", "Probe two", "Probe three", "Probe four"];
const seeded = performance.now();
for (const name of titles) {
  let session;
  for (let turn = 0; turn < turns; turn++) {
    fake.reply({
      content: [
        {
          type: "text",
          text:
            `${name} answer ${turn}. ` +
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(8) +
            "\n\n```ts\nconst value = " +
            turn +
            ";\n```",
        },
      ],
    });
    const content = `${name} question ${turn}`;
    let receipt;
    if (session === undefined)
      ({ session, receipt } = await host.sessions.start({ name, content }));
    else receipt = await session.send(content);
    const outcome = await receipt.settled();
    if (turn === 0) console.log("SEED OUTCOME", name, JSON.stringify(outcome).slice(0, 200));
  }
}
console.log(
  "SEEDED",
  titles.length,
  "x",
  turns,
  "turns in",
  Math.round(performance.now() - seeded),
  "ms",
);
await host.close();
const mainEntry =
  process.env.PROBE_MAIN ?? "/Applications/Nyte.app/Contents/Resources/app.asar/out/main/index.js";
await writeFile(
  join(root, "environment.mjs"),
  `import { app } from 'electron'; app.setPath('appData', ${JSON.stringify(appData)}); app.setPath('userData', ${JSON.stringify(join(appData, "profile"))});`,
);
await writeFile(
  join(root, "entry.mjs"),
  `import './environment.mjs'; import ${JSON.stringify(pathToFileURL(mainEntry).href)};`,
);
await writeFile(
  join(root, "package.json"),
  JSON.stringify({ name: "nyte-polish-probe", version: "0.0.17", main: "entry.mjs" }),
);
await symlink(new URL("../desktop/resources", import.meta.url).pathname, join(root, "resources"));
const env = { ...process.env, HOME: home };
delete env.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({
  executablePath: electronExecutable,
  args: [root, "--use-mock-keychain", "--password-store=basic"],
  env,
  timeout: 30000,
});
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log("PAGE ERROR", error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.log("CONSOLE", message.text());
  });
  await page.locator("[data-nyte-shell]").waitFor({ timeout: 30000 });
  await page.evaluate(() => {
    const log = [];
    window.__probe = log;
    let shown = null;
    const check = () => {
      const present =
        document.querySelector(
          "[data-message-id='row:skeleton'], [role='status'][aria-label='Loading chat']",
        ) !== null;
      if (present && shown === null) {
        shown = performance.now();
        log.push({ kind: "skeleton-on", at: shown });
      }
      if (!present && shown !== null) {
        log.push({
          kind: "skeleton-off",
          at: performance.now(),
          ms: Math.round(performance.now() - shown),
        });
        shown = null;
      }
    };
    new MutationObserver(check).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    check();
  });
  const mark = async (label) =>
    console.log("STEP", label, JSON.stringify(await page.evaluate(() => window.__probe.splice(0))));
  const nav = page.getByRole("navigation", { name: "Sessions and workspaces" });
  const done = nav.getByRole("button", { name: /Done/ });
  if (await done.count()) await done.first().click();
  console.log(
    "NAV BUTTONS",
    JSON.stringify(
      await nav
        .getByRole("button")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("aria-label") ?? node.textContent),
        ),
    ),
  );
  const open = async (name, step) => {
    const started = performance.now();
    if (!(await nav.getByRole("button", { name }).count())) {
      console.log("ROW HIDDEN, expanding Done", name);
      await nav.getByRole("button", { name: /Done/ }).first().click();
    }
    await nav.getByRole("button", { name }).first().click();
    await page
      .locator("main")
      .getByText(`${name} answer`, { exact: false })
      .first()
      .waitFor({ timeout: 15000 })
      .catch((error) => console.log("NO TRANSCRIPT", name, error.message.split("\n")[0]));
    console.log("OPEN", step, name, Math.round(performance.now() - started), "ms");
    await page.waitForTimeout(400);
    await mark(step);
  };
  const menuAction = async (name, action) => {
    if (!(await nav.getByRole("button", { name }).count())) {
      console.log("ROW HIDDEN, expanding Done", name);
      await nav.getByRole("button", { name: /Done/ }).first().click();
    }
    const row = nav.getByRole("button", { name }).first();
    await row.hover();
    await row.click({ button: "right" });
    const item = page.getByRole("menuitem", { name: action });
    if (await item.count().catch(() => 0)) {
      await item.first().click();
      return "context";
    }
    await page.keyboard.press("Escape");
    const more = nav.getByRole("button", {
      name: new RegExp(`(More|Options|Actions).*${name}|${name}.*(More|Options|Actions)`),
    });
    console.log("MORE COUNT", name, await more.count());
    if (await more.count()) {
      await more.first().click();
      await page.getByRole("menuitem", { name: action }).first().click();
      return "more";
    }
    const direct = nav.getByRole("button", { name: new RegExp(`${action}`) });
    console.log(
      "DIRECT",
      action,
      JSON.stringify(
        await direct.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("aria-label") ?? node.textContent),
        ),
      ),
    );
    await direct.first().click();
    return "direct";
  };
  await open("Probe one", "load-first");
  const archiveStarted = performance.now();
  console.log("ARCHIVE VIA", await menuAction("Probe one", /Archive/));
  await page.waitForTimeout(600);
  console.log(
    "ARCHIVE",
    Math.round(performance.now() - archiveStarted),
    "ms",
    "main:",
    (await page.locator("main").innerText()).slice(0, 160).replace(/\s+/g, " "),
  );
  await mark("archive");
  for (const wait of [0, 2000, 5000]) {
    await page.waitForTimeout(wait);
    console.log(
      "NAV AFTER ARCHIVE +",
      wait,
      JSON.stringify(await nav.innerText().catch((error) => error.message)),
    );
  }
  console.log("PIN VIA", await menuAction("Probe two", /^Pin/));
  await page.waitForTimeout(600);
  console.log("NAV AFTER PIN", JSON.stringify(await nav.innerText()));
  await mark("pin");
  const settingsStarted = performance.now();
  await page.keyboard.press("Meta+,");
  const back = page.getByRole("button", { name: /Back/ }).locator("visible=true");
  await back
    .first()
    .waitFor({ timeout: 10000 })
    .catch((error) => console.log("NO BACK", error.message.split("\n")[0]));
  console.log(
    "SETTINGS",
    Math.round(performance.now() - settingsStarted),
    "ms",
    JSON.stringify(
      await page
        .getByRole("button")
        .evaluateAll((nodes) =>
          nodes.slice(0, 12).map((node) => node.getAttribute("aria-label") ?? node.textContent),
        ),
    ),
  );
  await page.waitForTimeout(300);
  console.log(
    "SETTINGS MAIN",
    (await page.locator("main").innerText()).slice(0, 160).replace(/\s+/g, " "),
  );
  await mark("settings");
  const backStarted = performance.now();
  await back.first().click();
  await page.waitForTimeout(800);
  console.log(
    "BACK",
    Math.round(performance.now() - backStarted),
    "ms",
    "main:",
    (await page.locator("main").innerText()).slice(0, 160).replace(/\s+/g, " "),
  );
  await mark("back");
  await open("Probe three", "load-other");
  await open("Probe two", "load-pinned");
  await open("Probe four", "load-fourth");
  await page.screenshot({ path: join(tmpdir(), `nyte-polish-probe-${process.pid}.png`) });
  console.log("ERRORS", errors);
} finally {
  await application.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
