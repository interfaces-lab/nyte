import { expect, test } from "@playwright/test";
import { E2E_TOKEN, pairingLink } from "../server/address.ts";
import { collectErrors } from "../utils/errors.ts";

test("a new chat shows the reply and takes its title from the provider", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(pairingLink(E2E_TOKEN));
  await expect(page.getByRole("form", { name: "Message", exact: true })).toBeVisible();

  await page.getByRole("button", { name: /New Chat/u }).click();
  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("hello");
  await composer.press("Enter");

  const pane = page.getByRole("region", { name: "Active chat pane" });
  await expect(pane.getByText("Echo: hello", { exact: true })).toBeVisible();
  await expect(page.getByRole("banner").getByText("Echo: hello", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Sessions and workspaces" })
      .getByRole("button", { name: "Echo: hello" })
      .and(page.locator("[aria-current=page]")),
    "the server outlives a test, so only the current chat counts among same-titled ones",
  ).toBeVisible();
  await expect(page).toHaveURL(/\/session\/[^/?#]+$/u);
  const sessionUrl = page.url();

  await page.reload();
  await expect(pane.getByText("Echo: hello", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(sessionUrl);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/general$/u);
  await page.goBack();
  await expect(page).toHaveURL(sessionUrl);
  await expect(pane.getByText("Echo: hello", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/settings\/general$/u);
  await page.reload();
  await expect(page.getByRole("heading", { name: "General", exact: true })).toBeVisible();

  await page.evaluate(() => localStorage.setItem("nyte:startup-destination:v1", "last-session"));
  await page.goto(sessionUrl);
  await expect(pane.getByText("Echo: hello", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(sessionUrl);
  await page.getByRole("button", { name: /New Chat/u }).click();
  await expect(page).toHaveURL(new URL("/", sessionUrl).href);
  await expect(composer).toHaveText("");

  await page.reload();
  await expect(page).toHaveURL(/\/session\/[^/?#]+$/u);
  await expect(page.getByRole("form", { name: "Message", exact: true })).toBeVisible();
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("without a tab strip a child chat opens in the pane and the title bar's back control returns", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await page.goto(pairingLink(E2E_TOKEN));
  await page.getByRole("button", { name: /New Chat/u }).click();
  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("Start an agent.");
  await composer.press("Enter");

  const pane = page.getByRole("region", { name: "Active chat pane" });
  const banner = page.getByRole("banner");
  const card = pane.getByRole("button", { name: /^Map the core/u }).first();
  const back = banner.getByRole("link", { name: "Back to parent chat" });
  await expect(back, "a root chat has no back control").toHaveCount(0);
  await card.click();
  await expect(
    pane
      .getByRole("region", { name: "Messages" })
      .getByText("Echo: Trace part 1.", { exact: true }),
  ).toBeVisible();
  await expect(back).toBeVisible();

  const title = banner.getByText("Map the core", { exact: true });
  const actions = banner.getByRole("button", { name: "Split Right" });

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });

    const centres = await back.evaluate((link, label) => {
      const bar = link.closest("header");
      const text = [...(bar?.querySelectorAll("span") ?? [])].find(
        (span) => span.textContent === label,
      );
      const range = document.createRange();

      if (text !== undefined) range.selectNodeContents(text);
      const centre = (box: DOMRect | undefined): number =>
        box === undefined ? Number.NaN : box.top + box.height / 2;

      return {
        bar: centre(bar?.getBoundingClientRect()),
        button: centre(link.getBoundingClientRect()),
        title: centre(text?.getBoundingClientRect()),
        glyphs: centre(range.getBoundingClientRect()),
      };
    }, "Map the core");

    await testInfo.attach(`title-bar-centres-${scheme}`, {
      body: JSON.stringify(centres),
      contentType: "application/json",
    });
    await banner.screenshot({ path: testInfo.outputPath(`title-bar-child-${scheme}.png`) });

    for (const [name, centre] of Object.entries(centres))
      expect(
        Math.abs(centre - centres.bar),
        `${name} sits on the title bar's centre line`,
      ).toBeLessThanOrEqual(0.5);
  }

  await expect(title).toBeVisible();
  expect(
    (await back.boundingBox())?.height,
    "the back control has the title bar's control height",
  ).toBe((await actions.boundingBox())?.height);

  await back.click();
  await expect(card, "the back control returns to the parent in the same pane").toBeVisible();
  await expect(back).toHaveCount(0);
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});
