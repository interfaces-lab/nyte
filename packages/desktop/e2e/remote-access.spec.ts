import { expect, test } from "./fixtures.ts";
import { openSettings } from "./ui.ts";

test.use({ chapter: "remote-access" });

test("Settings > Server reads the host's own Tailscale node, off until turned on", async ({
  desktop,
}) => {
  const { page } = desktop;
  await openSettings(page, "Server");

  await expect(page.getByText("Tailscale node", { exact: true })).toBeVisible();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  const serve = page.getByRole("switch", { name: "Serve over Tailscale" });
  await expect(serve).not.toBeChecked();
  await expect(serve).toBeEnabled();
  await expect(page.getByText("Not shared", { exact: true })).toBeVisible();
});
