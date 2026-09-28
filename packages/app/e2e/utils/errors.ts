import type { Page } from "@playwright/test";

export interface PageProblems {
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
}

/** Collects uncaught exceptions and `console.error` output from the moment it is attached. */
export function collectErrors(page: Page): PageProblems {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  return { pageErrors, consoleErrors };
}
