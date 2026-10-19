import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import type { Page } from "@playwright/test";
import { messages, sidebar } from "../ui.ts";
import { launchDesktop, makeHome, newBuild, seed } from "./builds.ts";
import { serveModel } from "./model-server.ts";

const SOURCE = process.env.NYTE_FIXTURE_STORE ?? "";

if (SOURCE === "") throw new Error("Set NYTE_FIXTURE_STORE to a copy of a populated nyte.db.");

const build = newBuild();

await using model = await serveModel();

const parent = process.env.NYTE_FIRST_ROW_DIR ?? "/tmp";

const home = await makeHome(parent, model);

await copyFile(SOURCE, home.store);

await seed(build, home);

const appData = join(home.root, "app-data");

async function firstRow(page: Page, since: number): Promise<number> {
  const deadline = since + 30_000;

  while (performance.now() < deadline) {
    const loading = await page.getByRole("status", { name: "Loading chat" }).count();

    const shown =
      (
        await messages(page)
          .innerText()
          .catch(() => "")
      ).trim().length > 0;

    if (loading === 0 && shown) return performance.now() - since;
    await sleep(10);
  }

  return Number.NaN;
}

const clicked: number[] = [];

let restored = Number.NaN;

{
  await using desktop = await launchDesktop(build, home, { appData });
  await sleep(2_000);

  const titles = (await sidebar(desktop.page).getByRole("button").allInnerTexts())
    .filter(
      (name) =>
        name.includes("\n") &&
        !/^(New Chat|New chat|Search|Settings|Customize|Environments|Show|Back)/u.test(name),
    )
    .map((name) => name.split("\n")[0] ?? "")
    .slice(0, 12);

  for (const title of titles) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
    const at = performance.now();
    await sidebar(desktop.page)
      .getByRole("button", { name: new RegExp(`^(Unread )?${escaped} `, "u") })
      .first()
      .click();
    clicked.push(await firstRow(desktop.page, at));
  }
}

{
  const launched = performance.now();
  await using desktop = await launchDesktop(build, home, { appData });
  restored = await firstRow(desktop.page, launched);
}

const sorted = [...clicked].sort((left, right) => left - right);

const quantile = (q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;

process.stdout.write(
  `${JSON.stringify({ chats: sorted.length, clickP50: Math.round(quantile(0.5)), clickP95: Math.round(quantile(0.95)), clickMax: Math.round(sorted.at(-1) ?? Number.NaN), launchToRestoredRow: Math.round(restored), samples: clicked.map(Math.round) })}\n`,
);
