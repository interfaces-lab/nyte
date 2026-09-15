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

afterEach(() => {
  for (const key of [first, second]) {
    workbenchController.actions.closeTab(key, "browser");
    workbenchController.actions.closeTab(key, "terminal");
    workbenchController.actions.setBrowserUrl(key, undefined);
    forgetBrowserSurface(key);
  }
  forgetBrowserSurface("unknown-surface");
});

describe("browser navigation state", () => {
  test("remembers native navigation for the matching view when its browser is reopened", () => {
    workbenchController.actions.openTab(first, "browser");
    workbenchController.actions.setBrowserUrl(first, "https://example.com/requested");
    workbenchController.actions.openTab(second, "browser");
    workbenchController.actions.setBrowserUrl(second, "https://example.com/other");

    applyBrowserEvent({
      kind: "browser_changed",
      surface: first,
      state: page("https://example.com/redirected"),
    });
    assert.equal(workbenchController.getView(first).browserUrl, "https://example.com/redirected");
    assert.equal(workbenchController.getView(second).browserUrl, "https://example.com/other");

    applyBrowserEvent({
      kind: "browser_changed",
      surface: first,
      state: page("https://example.com/back"),
    });
    workbenchController.actions.closeTab(first, "browser");
    forgetBrowserSurface(first);
    workbenchController.actions.openTab(first, "browser");
    assert.equal(workbenchController.getView(first).browserUrl, "https://example.com/back");
  });

  test("remembers navigation while the browser tab and workbench are hidden", () => {
    workbenchController.actions.openTab(first, "browser");
    workbenchController.actions.openTab(first, "terminal");
    workbenchController.actions.toggle(first);

    applyBrowserEvent({
      kind: "browser_changed",
      surface: first,
      state: page("https://example.com/background"),
    });

    assert.equal(workbenchController.getView(first).browserUrl, "https://example.com/background");
    assert.equal(workbenchController.getView(first).activeTab, "terminal");
    assert.equal(workbenchController.getView(first).expanded, false);
  });

  test("blank pages and refused downloads do not replace the requested URL", () => {
    workbenchController.actions.openTab(first, "browser");
    workbenchController.actions.setBrowserUrl(first, "https://example.com/requested");

    applyBrowserEvent({ kind: "browser_changed", surface: first, state: page("") });
    assert.equal(workbenchController.getView(first).browserUrl, "https://example.com/requested");

    applyBrowserEvent({
      kind: "browser_download_refused",
      surface: first,
      url: "https://example.com/download.zip",
    });
    assert.equal(workbenchController.getView(first).browserUrl, "https://example.com/requested");
  });

  test("late events for closed or unknown surfaces do not change workbench views", () => {
    workbenchController.actions.openTab(first, "browser");
    workbenchController.actions.setBrowserUrl(first, "https://example.com/remembered");
    workbenchController.actions.closeTab(first, "browser");

    applyBrowserEvent({
      kind: "browser_changed",
      surface: first,
      state: page("https://example.com/late"),
    });
    assert.equal(workbenchController.getView(first).browserUrl, "https://example.com/remembered");
    assert.deepEqual(workbenchController.getView(first).openTabs, []);

    const views = [...workbenchController.getSnapshot().views];
    applyBrowserEvent({
      kind: "browser_changed",
      surface: "unknown-surface",
      state: page("https://example.com/unknown"),
    });
    assert.deepEqual([...workbenchController.getSnapshot().views], views);
  });
});
