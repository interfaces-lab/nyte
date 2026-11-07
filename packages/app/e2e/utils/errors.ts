import type { Page } from "@playwright/test";

interface PageProblems {
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
}

export function collectErrors(page: Page): PageProblems {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  return { pageErrors, consoleErrors };
}
