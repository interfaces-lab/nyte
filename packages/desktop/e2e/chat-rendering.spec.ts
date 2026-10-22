import type { Locator, Page, TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { chatPane, composer, messages, openChat, openNewChat, send } from "./ui.ts";

test.use({ chapter: "chat-rendering" });

const PROMPT = "the footer fix is support to work";

interface FrameProbe {
  phase: string;
  coverage: boolean;
  frames: number;
  pendingFrames: number;
  readonly failures: string[];
  readonly layout: { readonly headerHeight: number; readonly endGap: number };
  anchor: { readonly element: Element; readonly top: number } | null;
  handoff: {
    readonly previous: Element;
    readonly text: string;
    readonly height: number;
    footer: Element | null;
    seen: boolean;
  } | null;
  readonly stop: () => void;
}

declare global {
  interface Window {
    chatRenderingProbe?: FrameProbe;
  }
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot });
  await testInfo.attach(name, { path: screenshot, contentType: "image/png" });
  const accessibility = testInfo.outputPath(`${name}-accessibility.txt`);
  await writeFile(accessibility, await page.locator("body").ariaSnapshot());
  await testInfo.attach(`${name}-accessibility`, {
    path: accessibility,
    contentType: "text/plain",
  });
}

async function phase(page: Page, name: string, coverage = true): Promise<void> {
  await page.evaluate(
    ({ name, coverage }) => {
      const probe = window.chatRenderingProbe;

      if (probe === undefined) throw new Error("Frame observation is not installed");
      probe.phase = name;
      probe.coverage = coverage;
    },
    { name, coverage },
  );
}

async function observeFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const initial = [
      ...document.querySelectorAll<HTMLElement>("[role='region'][aria-label='Messages']"),
    ].find((element) => element.clientHeight > 0 && element.getClientRects().length > 0);

    const footer = initial?.querySelector("[data-row-key^='changes:']");
    const dock = initial?.parentElement?.querySelector("[data-composer-region]")?.parentElement;

    if (
      initial === undefined ||
      footer === null ||
      footer === undefined ||
      dock === null ||
      dock === undefined
    )
      throw new Error("A completed chat is required to observe its layout");
    const pinned = initial.querySelector("[data-sticky-active='true']");
    let active = true;
    let frame = 0;

    const probe: FrameProbe = {
      phase: "follow-ups",
      coverage: true,
      frames: 0,
      pendingFrames: 0,
      failures: [],
      layout: {
        headerHeight: pinned?.getBoundingClientRect().height ?? 0,
        endGap: dock.getBoundingClientRect().top - footer.getBoundingClientRect().bottom,
      },
      anchor: null,
      handoff: null,
      stop: () => {
        active = false;
        cancelAnimationFrame(frame);
      },
    };

    window.chatRenderingProbe = probe;

    const fail = (detail: string): void => {
      const message = `${probe.phase}: ${detail}`;

      if (!probe.failures.includes(message)) probe.failures.push(message);
    };

    const inspect = (): void => {
      const viewport = [
        ...document.querySelectorAll<HTMLElement>("[role='region'][aria-label='Messages']"),
      ].find((element) => element.clientHeight > 0 && element.getClientRects().length > 0);

      if (viewport === undefined) return;
      probe.frames += 1;
      const box = viewport.getBoundingClientRect();
      const dock = viewport.parentElement?.querySelector("[data-composer-region]")?.parentElement;
      const top = box.top + probe.layout.headerHeight;
      const bottom = (dock?.getBoundingClientRect().top ?? box.bottom) - probe.layout.endGap;

      const visible = [...viewport.querySelectorAll<HTMLElement>("[data-row-key]")]
        .flatMap((element) => {
          const bounds = element.getBoundingClientRect();

          return bounds.bottom > top && bounds.top < bottom
            ? [{ key: element.dataset.rowKey, box: bounds }]
            : [];
        })
        .toSorted((first, second) => first.box.top - second.box.top);

      let edge = top;
      let gap = 0;

      for (const row of visible) {
        gap = Math.max(gap, row.box.top - edge);
        edge = Math.max(edge, row.box.bottom);
      }

      gap = Math.max(gap, bottom - edge);

      if (probe.coverage && bottom > top && gap > 1)
        fail(
          `uncovered ${gap.toFixed(1)}px at scroll ${viewport.scrollTop.toFixed(1)}: ${visible.map((row) => row.key).join(",")}`,
        );

      const anchor = probe.anchor;

      if (
        anchor !== null &&
        (!anchor.element.isConnected ||
          Math.abs(anchor.element.getBoundingClientRect().top - anchor.top) > 1)
      )
        fail("editing moved or replaced the prompt");

      const footers = [...viewport.querySelectorAll<HTMLElement>("[data-row-key^='changes:']")];

      if (
        viewport.querySelector("[data-sticky-user-message] [aria-busy='true']") !== null &&
        footers.some((footer) => footer.querySelector("section") !== null)
      )
        fail("an edit submission retained the completed changes card");
      const handoff = probe.handoff;

      if (handoff === null) return;

      const prompt = [...viewport.querySelectorAll<HTMLElement>("[data-row-key^='prompt:']")].find(
        (row) =>
          row.querySelector("[data-composer-readonly]")?.textContent?.trim() === handoff.text,
      );

      if (prompt === undefined) return;
      handoff.seen = true;

      if (handoff.previous.isConnected) fail("the new prompt retained the previous footer");
      const key = prompt.dataset.rowKey?.replace(/^prompt:/u, "changes:");
      const footer = footers.find((row) => row.dataset.rowKey === key);

      if (footers.length !== 1 || footer === undefined) {
        fail("the new prompt has no unique reserved footer");

        return;
      }

      handoff.footer ??= footer;

      if (footer !== handoff.footer) fail("completion replaced the pending footer");

      if (footer.getBoundingClientRect().height + 1 < handoff.height)
        fail("the pending reservation collapsed below the previous ready footer");

      const running =
        viewport.parentElement?.querySelector("button[aria-label='Stop response']") !== null;

      if (running) {
        probe.pendingFrames += 1;

        if (footer.querySelector("section") !== null)
          fail("a running turn exposed the previous card");
      }
    };

    const next = (): void => {
      frame = requestAnimationFrame(() =>
        setTimeout(() => {
          if (!active) return;
          inspect();
          next();
        }, 0),
      );
    };

    next();
  });
}

async function holdPrompt(prompt: Locator): Promise<void> {
  await prompt.evaluate((element) => {
    const probe = window.chatRenderingProbe;

    if (probe === undefined) throw new Error("Frame observation is not installed");
    probe.anchor = { element, top: element.getBoundingClientRect().top };
  });
}

async function observeAction(page: Page, name: string, action: () => Promise<void>): Promise<void> {
  await phase(page, name);
  await action();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
  );
  await phase(page, `${name} complete`);
}

test("chat preserves visible rows, the latest summary and message editing", async ({
  desktop,
}, testInfo) => {
  test.setTimeout(240_000);
  const { page, application, home } = desktop;
  const log = messages(page);
  const card = log.getByRole("region", { name: / Files? Changed$/u });
  const folder = join(home, "render-workspace");
  await mkdir(folder);
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, folder);
  await page.keyboard.press("ControlOrMeta+o");
  await openNewChat(page);
  await expect(page.getByRole("button", { name: "render-workspace", exact: true })).toBeVisible();
  await send(page, "/render-change");
  await expect(chatPane(page).getByRole("button", { name: "Stop response" })).toBeHidden();
  await expect(card).toBeVisible();
  await expect(card.getByText("render-proof.txt", { exact: true })).toBeVisible();
  await observeFrames(page);
  const replay = testInfo.outputPath("replay.webm");
  await page.screencast.start({
    path: replay,
    fps: 30,
    quality: 80,
    size: { width: 1440, height: 1000 },
  });

  try {
    await capture(page, testInfo, "01-files-changed");
    await phase(page, "review changes from the summary");
    await card.getByRole("button", { name: "Review", exact: true }).click();
    const changes = page
      .getByRole("complementary", { name: "Workbench" })
      .getByRole("tabpanel", { name: "Changes" });
    await expect(changes.getByRole("button", { name: /^This Chat\b/u })).toBeVisible();
    await expect(changes.getByRole("code")).toContainText("render proof");
    await capture(page, testInfo, "01a-review-changes");
    await page.getByRole("button", { name: "Close workbench panel" }).click();
    await card.getByRole("button", { name: "Open render-proof.txt in Changes" }).click();
    await expect(
      changes.getByRole("button", { name: /^Collapse render-proof\.txt\b/u }),
    ).toBeVisible();
    await expect(changes.getByRole("code")).toContainText("render proof");
    await page.getByRole("button", { name: "Close workbench panel" }).click();

    for (const text of ["First follow-up", "Second follow-up"]) {
      await send(page, text);
      await expect(log.getByText(`Echo: ${text}`, { exact: true })).toBeVisible();
      await expect(card).toBeVisible();
    }

    await capture(page, testInfo, "02-two-follow-ups");
    await phase(page, "switch away", false);
    await openChat(page, FIXTURES.alpha);
    await expect(messages(page).getByText("Echo: Hello from alpha", { exact: true })).toBeVisible();
    await capture(page, testInfo, "03-alpha");
    await openChat(page, "/render-change");
    await expect(card).toBeVisible();
    await phase(page, "native history scrolling");
    await log.hover();

    for (let turn = 0; turn < 6; turn += 1)
      await observeAction(page, `history up ${String(turn + 1)}`, () => page.mouse.wheel(0, -600));
    await capture(page, testInfo, "04-scrolled-up");

    for (let turn = 0; turn < 6; turn += 1)
      await observeAction(page, `history down ${String(turn + 1)}`, () => page.mouse.wheel(0, 600));
    const bottom = chatPane(page).getByRole("button", { name: "Scroll to bottom", exact: true });

    if (await bottom.isVisible()) await bottom.click();
    await expect(card).toBeInViewport();
    await capture(page, testInfo, "05-back-at-end");

    await phase(page, "new turn footer handoff");
    await log.locator("[data-row-key^='changes:']").evaluate((element, text) => {
      const probe = window.chatRenderingProbe;

      if (probe === undefined) throw new Error("Frame observation is not installed");
      probe.handoff = {
        previous: element,
        text,
        height: element.getBoundingClientRect().height,
        footer: null,
        seen: false,
      };
      probe.pendingFrames = 0;
    }, PROMPT);
    const field = composer(page);
    await field.pressSequentially(PROMPT);
    await expect(field).toHaveText(PROMPT);
    await observeAction(page, "send the recorded prompt", () => field.press("Enter"));
    await expect(chatPane(page).getByRole("button", { name: "Stop response" })).toBeVisible();
    await expect(card).toHaveCount(0);
    await capture(page, testInfo, "06-pending-reservation");
    await expect(log.getByText(`Echo: ${PROMPT}`, { exact: true })).toBeVisible();
    await expect(card).toBeVisible();
    await capture(page, testInfo, "07-completed-reservation");

    const pending = await page.evaluate(() => ({
      seen: window.chatRenderingProbe?.handoff?.seen,
      frames: window.chatRenderingProbe?.pendingFrames ?? 0,
    }));

    expect(pending.seen).toBe(true);
    expect(pending.frames).toBeGreaterThan(0);
    await page.evaluate(() => {
      if (window.chatRenderingProbe !== undefined) window.chatRenderingProbe.handoff = null;
    });

    await phase(page, "edit and cancel");

    const prompt = log
      .locator("[data-row-key^='prompt:']")
      .filter({ hasText: PROMPT })
      .locator("[data-sticky-user-message]");

    const original = await prompt.locator("[data-composer-readonly]").innerText();
    const appended = " edited";
    const edited = `${original}${appended}`;

    await holdPrompt(prompt);
    await observeAction(page, "open the message editor", () =>
      prompt.getByRole("button", { name: "Edit Message", exact: true }).press("F2"),
    );
    const editor = prompt.getByRole("combobox", { name: "Message", exact: true });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText(original);
    await observeAction(page, "type into the message editor", () =>
      editor.pressSequentially(appended),
    );
    await expect(editor).toHaveText(edited);
    await capture(page, testInfo, "08-edited-prompt");
    await observeAction(page, "cancel the message edit", () => editor.press("Escape"));
    await expect(editor).toHaveCount(0);
    await expect(prompt.locator("[data-composer-readonly]")).toHaveText(original);
    await capture(page, testInfo, "09-cancelled-edit");

    await phase(page, "edit and save");
    await observeAction(page, "reopen the message editor", () =>
      prompt.getByRole("button", { name: "Edit Message", exact: true }).press("F2"),
    );
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText(original);
    await observeAction(page, "type the replacement message", () =>
      editor.pressSequentially(appended),
    );
    await expect(editor).toHaveText(edited);
    await page.evaluate(() => {
      if (window.chatRenderingProbe !== undefined) window.chatRenderingProbe.anchor = null;
    });
    await observeAction(page, "submit the message edit", () => editor.press("Enter"));
    await expect(card).toHaveCount(0);
    await capture(page, testInfo, "10-edit-submitted");
    await expect(log.getByText(`Echo: ${edited}`, { exact: true })).toBeVisible();
    await expect(card).toBeVisible();
    await capture(page, testInfo, "11-edit-completed");
  } finally {
    await page.screencast.stop();
    await testInfo.attach("replay", { path: replay, contentType: "video/webm" });

    const observations = await page.evaluate(() => {
      const probe = window.chatRenderingProbe;
      probe?.stop();

      return {
        frames: probe?.frames ?? 0,
        pendingFrames: probe?.pendingFrames ?? 0,
        failures: probe?.failures ?? ["Frame observation was lost"],
        layout: probe?.layout,
      };
    });

    const frames = testInfo.outputPath("chat-rendering-frames.json");
    await writeFile(frames, JSON.stringify(observations, null, 2));
    await testInfo.attach("chat-rendering-frames", {
      path: frames,
      contentType: "application/json",
    });
    await capture(page, testInfo, "12-final-state");
    expect(observations.frames).toBeGreaterThan(0);
    expect(observations.failures).toEqual([]);
  }
});
