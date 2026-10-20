import type { Locator, Page } from "@playwright/test";

export function sidebar(page: Page): Locator {
  return page.getByRole("navigation", { name: "Sessions and workspaces" });
}

export function chatPane(page: Page): Locator {
  return page.getByRole("region", { name: "Active chat pane" });
}

export function composer(page: Page): Locator {
  return page.getByRole("combobox", { name: "Message" });
}

export function messages(page: Page): Locator {
  return page.getByRole("region", { name: "Messages", exact: true });
}
