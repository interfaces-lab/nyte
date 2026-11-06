import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:5178/", { waitUntil: "networkidle" });
for (const label of ["Appearance", "Core"]) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const popup = page.locator("[data-slot=dialog-popup]");
  await popup.waitFor();
  await page.waitForTimeout(label === "Core" ? 8000 : 2000);
  const m = await popup.evaluate((p) => {
    const body = p.lastElementChild;
    body.scrollTop = body.scrollHeight;
    return { popupClient: p.clientHeight, popupScroll: p.scrollHeight, popupTop: p.scrollTop, bodyClient: body.clientHeight, bodyScroll: body.scrollHeight };
  });
  console.log(label, JSON.stringify(m), "errorText:", await page.getByText(/went wrong|deferred entry/).count());
  await page.screenshot({ path: `/tmp/lab-${label}.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}
console.log("pageerrors", errors);
await browser.close();
