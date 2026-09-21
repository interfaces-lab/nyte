import assert from "node:assert/strict";
import { afterEach, describe, test } from "vitest";
import type { BrowserSurfaceState } from "../../../shared/ipc.ts";
import { applyBrowserEvent, forgetBrowserSurface } from "./browser-surfaces.ts";
import { workbenchController, workbenchViewKey } from "./controller.ts";

const first = workbenchViewKey({ paneKey: "browser-events-first", target: { kind: "home" } });
const second = workbenchViewKey({ paneKey: "browser-events-second", target: { kind: "home" } });

function page(url: string): BrowserSurfaceState {
  return {
    url,
    title: "Example",
    loading: false,
    canGoBack: true,
    canGoForward: false,
    secure: "https",
    blocking: false,
    blocked: 0,
    error: undefined,
    agentHolders: 0,
  };
}

function openBrowser(view: string, url: string): string {
  return workbenchController.actions.openTab({
    view,
    tab: { kind: "browser", url },
    activate: true,
  });
}

function browserUrl(view: string, id: string): string | undefined {
  const tab = workbenchController.getView(view).tabs.find((candidate) => candidate.id === id);
  return tab?.kind === "browser" ? tab.url : undefined;
}

afterEach(() => {
  for (const view of [first, second]) {
    for (const tab of workbenchController.getView(view).tabs) {
      workbenchController.actions.closeTab({ view, id: tab.id });
      forgetBrowserSurface(tab.id);
    }
  }
  forgetBrowserSurface("unknown-surface");
});

describe("browser navigation state", () => {
  test("updates the matching browser tab without disturbing another tab", () => {
    const firstTab = openBrowser(first, "https://example.com/requested");
    const secondTab = openBrowser(second, "https://example.com/other");

    applyBrowserEvent({
      kind: "browser_changed",
      surface: firstTab,
      state: page("https://example.com/redirected"),
    });

    assert.equal(browserUrl(first, firstTab), "https://example.com/redirected");
    assert.equal(browserUrl(second, secondTab), "https://example.com/other");
  });

  test("remembers navigation while another interleaved tab is active", () => {
    const browser = openBrowser(first, "about:blank");
    const terminal = workbenchController.actions.openTab({
      view: first,
      tab: { kind: "terminal", owner: { kind: "user" } },
      activate: true,
    });
    workbenchController.actions.toggle({ view: first });

    applyBrowserEvent({
      kind: "browser_changed",
      surface: browser,
      state: page("https://example.com/background"),
    });

    assert.equal(browserUrl(first, browser), "https://example.com/background");
    assert.equal(workbenchController.getView(first).active, terminal);
    assert.equal(workbenchController.getView(first).expanded, false);
  });

  test("blank pages and late events for closed tabs do not replace state", () => {
    const browser = openBrowser(first, "https://example.com/requested");
    applyBrowserEvent({ kind: "browser_changed", surface: browser, state: page("") });
    assert.equal(browserUrl(first, browser), "https://example.com/requested");

    workbenchController.actions.closeTab({ view: first, id: browser });
    applyBrowserEvent({
      kind: "browser_changed",
      surface: browser,
      state: page("https://example.com/late"),
    });
    assert.equal(workbenchController.getView(first).tabs.length, 0);
  });
});
