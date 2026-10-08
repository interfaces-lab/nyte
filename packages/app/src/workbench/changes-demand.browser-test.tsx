import {
  ABSENT,
  COMMIT_OID,
  FILE_COUNT,
  PATHS,
  TOO_LARGE,
  demandScript,
  pathAt,
  patchFor,
  releaseHeld,
} from "./changes-demand-preload.ts";
import "../../test/window-bridge.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import type { ReactElement } from "react";
import { queryClient, refreshVcs } from "../queries.ts";
import { ChangesPanel } from "./changes-panel.tsx";
import { changesScopeValue } from "./change-scopes.ts";
import { changesViewed, patchDigest } from "./changes-viewed.ts";
import type { WorkbenchChangesScope } from "./controller.ts";
import { applyDisplayMode } from "../theme/appearance.ts";
import "../theme/tokens.stylex.ts";

async function until(predicate: () => boolean, what: string, timeout = 8_000): Promise<void> {
  const deadline = performance.now() + timeout;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

const frame = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

/** A frame and every animation callback in it have run, CodeView's own render included. */
const painted = async (): Promise<void> => {
  await frame();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
};

/** Frames pass and the host stays unasked for a while: the stack has stopped demanding. */
async function quiet(): Promise<void> {
  let calls = -1;

  while (calls !== demandScript.diffCalls.length || demandScript.active > 0) {
    calls = demandScript.diffCalls.length;

    for (let pass = 0; pass < 6; pass += 1) await frame();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
  }
}

const requested = (from = 0): readonly string[] =>
  demandScript.diffCalls.slice(from).flatMap((call) => call.paths);

const largestCall = (from = 0): number =>
  Math.max(0, ...demandScript.diffCalls.slice(from).map((call) => call.paths.length));

const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = values.toSorted((left, right) => left - right);

  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0);
};

/** Notices, not diffs: their bodies have no diff lines to look for. */
const NOTICES = new Set([ABSENT, TOO_LARGE]);

export async function run(): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:600px;width:1000px";
  document.body.append(container);
  const root = createRoot(container);

  const Panel = ({
    scope,
    visible,
  }: {
    readonly scope: WorkbenchChangesScope;
    readonly visible: boolean;
  }): ReactElement => {
    const [selectedPath, setSelectedPath] = useState<string>();
    const [revealRevision, setRevealRevision] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);

    return (
      <QueryClientProvider client={queryClient}>
        <ChangesPanel
          visible={visible}
          sessionId={undefined}
          scope={scope}
          selectedPath={selectedPath}
          revealPathRevision={revealRevision}
          scrollTop={scrollTop}
          fileTreeVisible
          onScopeChange={() => undefined}
          onToggleFileTree={() => undefined}
          onSelectPath={setSelectedPath}
          onRevealPath={(path) => {
            setSelectedPath(path);
            setRevealRevision((revision) => revision + 1);
          }}
          onScrollTop={setScrollTop}
        />
      </QueryClientProvider>
    );
  };

  // A new mount is a new panel, with its own loader and nothing read yet.
  const render = (
    mount: number,
    scope: WorkbenchChangesScope = { kind: "uncommitted" },
    visible = true,
  ): void => {
    flushSync(() => root.render(<Panel key={mount} scope={scope} visible={visible} />));
  };

  const scrollport = (): HTMLElement => {
    const found = container.querySelector("[data-nyte-scrollport]");

    if (!(found instanceof HTMLElement)) throw new Error("Missing the stack scrollport");

    return found;
  };

  const header = (path: string): HTMLElement | undefined => {
    const found = container.querySelector(`[data-change-path="${path}"]`);

    return found instanceof HTMLElement ? found : undefined;
  };

  const headerOffset = (path: string): number | null => {
    const found = header(path);

    return found === undefined
      ? null
      : Math.round(found.getBoundingClientRect().top - scrollport().getBoundingClientRect().top);
  };

  const headerStats = (path: string): string | null =>
    header(path)?.querySelector('[aria-label$=" removed"]')?.getAttribute("aria-label") ?? null;

  const viewedState = (path: string): string | null =>
    header(path)?.querySelector("[data-viewed-state]")?.getAttribute("data-viewed-state") ?? null;

  const sidebarCount = (): string =>
    /\d+ Files? Changed/.exec(container.textContent ?? "")?.[0] ?? "";

  // Every diff line names its file, so the rendered text says whose patch is on screen.
  const renderedText = (): string =>
    Array.from(container.querySelectorAll("diffs-container"))
      .map((node) => node.shadowRoot?.textContent ?? "")
      .join("\n");

  /**
   * The files on screen: each rendered item's header, where it sits in the
   * scrollport, and whether its body shows diff lines or only the header.
   */
  const onScreen = () => {
    const port = scrollport();
    const top = port.getBoundingClientRect().top;
    const height = port.clientHeight;

    return Array.from(container.querySelectorAll("diffs-container")).flatMap((node) => {
      const head = node.querySelector("[data-change-path]");

      if (!(head instanceof HTMLElement)) return [];
      const offset = head.getBoundingClientRect().top - top;

      if (offset < 0 || offset >= height - head.offsetHeight * 2) return [];
      const path = head.getAttribute("data-change-path") ?? "";

      return [
        {
          path,
          offset,
          height: head.offsetHeight,
          expanded: head.querySelector('[aria-expanded="true"]') !== null,
          body: NOTICES.has(path) || node.shadowRoot?.querySelector("[data-line-type]") != null,
        },
      ];
    });
  };

  const headerOnly = (): readonly string[] =>
    onScreen()
      .filter((item) => item.expanded && !item.body)
      .map((item) => item.path);

  const menuItem = async (label: string): Promise<void> => {
    const trigger = container.querySelector('button[aria-label="More changes options"]');

    if (!(trigger instanceof HTMLElement)) throw new Error("Missing the changes options menu");
    trigger.click();
    await until(
      () =>
        Array.from(document.querySelectorAll('[role="menuitem"]')).some(
          (item) => item.textContent?.includes(label) === true,
        ),
      `the ${label} menu item`,
    );

    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (candidate) => candidate.textContent?.includes(label) === true,
    );

    if (!(item instanceof HTMLElement)) throw new Error(`Missing ${label}`);
    item.click();
  };

  const filterField = (): HTMLInputElement => {
    const filter = container.querySelector('input[aria-label="Filter changed files"]');

    if (!(filter instanceof HTMLInputElement)) throw new Error("Missing the file filter");

    return filter;
  };

  /** Reveals a file the way a reader does: filter the tree, then click its row. */
  const revealFromTree = async (path: string, query: string): Promise<void> => {
    const filter = filterField();
    filter.focus();
    filter.select();
    document.execCommand("insertText", false, query);

    const treeRow = (): HTMLElement | undefined => {
      const row = container
        .querySelector("file-tree-container")
        ?.shadowRoot?.querySelector(`[role="treeitem"][data-item-path="${path}"]`);

      return row instanceof HTMLElement ? row : undefined;
    };

    await until(() => treeRow() !== undefined, "the filtered tree row");
    treeRow()?.click();
  };

  const clearFilter = async (): Promise<void> => {
    const filter = filterField();
    filter.focus();
    filter.select();
    document.execCommand("delete");
    await until(() => filter.value === "", "the cleared filter");
  };

  const observations: Record<string, object> = {};

  try {
    const uncommitted: WorkbenchChangesScope = { kind: "uncommitted" };
    const viewedScope = `demand-repo\u0000${changesScopeValue(uncommitted)}`;
    changesViewed.markViewed(viewedScope, {
      path: pathAt(0),
      digest: patchDigest(patchFor(pathAt(0), "worktree")),
    });

    // Metadata first: the tree is whole while the manifest and the first patches are held.
    demandScript.holdDiff = true;
    demandScript.holdChanges = true;
    render(1);
    await until(() => sidebarCount() === `${String(FILE_COUNT)} Files Changed`, "the whole tree");
    await until(() => demandScript.diffCalls.length === 1, "the first patch read");
    await until(() => header(pathAt(0)) !== undefined, "the first header");

    observations.metadataFirst = {
      treeReady: container.querySelector("file-tree-container") !== null,
      sidebarCount: sidebarCount(),
      eventsBeforeFirstDiff: demandScript.events.slice(
        0,
        demandScript.events.findIndex((event) => event.startsWith("diff:")),
      ),
      firstRead: demandScript.diffCalls[0]?.paths ?? [],
      headersRendered: container.querySelectorAll("[data-change-path]").length,
      unreadStats: headerStats(pathAt(0)),
      unreadViewed: viewedState(pathAt(0)),
    };

    // Collapsed files cost nothing, wherever the stack scrolls.
    await menuItem("Collapse All Files");
    await frame();
    demandScript.holdDiff = false;
    demandScript.holdChanges = false;
    releaseHeld();
    await quiet();
    await until(() => headerStats(pathAt(0)) !== null, "the manifest counts");
    const callsWhileCollapsed = demandScript.diffCalls.length;
    const readStats = headerStats(pathAt(0));
    const readViewed = viewedState(pathAt(0));
    scrollport().scrollTop = scrollport().scrollHeight / 2;
    await quiet();

    observations.collapsed = {
      callsAfterRelease: callsWhileCollapsed,
      callsAfterScroll: demandScript.diffCalls.length,
      readStats,
      readViewed,
    };

    // Marking every collapsed file reads the rest in bounded batches, one at a time.
    const beforeMark = demandScript.diffCalls.length;
    const markAll = container.querySelector('[aria-label="Mark all files viewed"]');

    if (!(markAll instanceof HTMLElement)) throw new Error("Missing the mark-all checkbox");
    markAll.click();
    await until(
      () => container.textContent?.includes("wasn’t marked viewed") === true,
      "the unread-file report",
      20_000,
    );
    await quiet();

    observations.markAll = {
      calls: demandScript.diffCalls.length - beforeMark,
      largestCall: largestCall(beforeMark),
      distinct: new Set(requested()).size,
      repeated: requested().length - new Set(requested()).size,
      absentRequests: requested().filter((path) => path === ABSENT).length,
      tooLargeRequests: requested().filter((path) => path === TOO_LARGE).length,
      peak: demandScript.peak,
      report:
        Array.from(container.querySelectorAll('[role="status"]'))
          .map((node) => node.textContent ?? "")
          .find((text) => text.includes("marked viewed")) ?? null,
    };

    // A fresh panel, every file expanded: the whole review is read without scrolling.
    const preparedFrom = demandScript.diffCalls.length;
    demandScript.peak = 0;
    render(2);
    await until(() => header(pathAt(0)) !== undefined, "the remounted stack");
    const extentBefore = scrollport().scrollHeight;
    await until(
      () => new Set(requested(preparedFrom)).size === FILE_COUNT,
      "every file to be read",
      20_000,
    );
    await quiet();
    const extentAfter = scrollport().scrollHeight;
    const scrollTopAfter = scrollport().scrollTop;

    // Far down, every file on screen already has its body and nothing new is read.
    const callsBeforeJump = demandScript.diffCalls.length;
    scrollport().scrollTop = Math.round(extentAfter * 0.66);
    await painted();
    await painted();
    const jumpedTo = onScreen().map((item) => item.path);
    const headerOnlyAfterJump = headerOnly();
    await quiet();
    const top = onScreen()[0];
    const scrolledTo = scrollport().scrollTop;

    // The panel hides and shows again: the stack remounts where it was.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 300));
    render(2, uncommitted, false);
    await painted();
    render(2, uncommitted, true);
    await until(() => top !== undefined && header(top.path) !== undefined, "the restored header");
    await painted();
    await painted();

    observations.prepared = {
      requested: requested(preparedFrom).length,
      distinct: new Set(requested(preparedFrom)).size,
      calls: callsBeforeJump - preparedFrom,
      largestCall: largestCall(preparedFrom),
      peak: demandScript.peak,
      scrollTopWhilePreparing: scrollTopAfter,
      extentBefore,
      extentAfter,
      jumpedTo,
      headerOnlyAfterJump,
      readsAfterJump: demandScript.diffCalls.length - callsBeforeJump,
      restoredPath: top?.path ?? null,
      restoredTopPath: onScreen()[0]?.path ?? null,
      restoredShift: Math.round(scrollport().scrollTop - scrolledTo),
      readsAfterRestore: demandScript.diffCalls.length - callsBeforeJump,
    };

    // Another fresh panel, reads slowed to the real host's pace, the first one held.
    const slowFrom = demandScript.diffCalls.length;
    demandScript.peak = 0;
    demandScript.latencyMs = 60;
    demandScript.holdDiff = true;
    render(3);
    await until(() => demandScript.heldDiffs.length === 1, "a held background read");
    await until(() => header(pathAt(0)) !== undefined, "the third stack");

    // A file revealed while a background read is in flight is the next read.
    const target = pathAt(150);
    const heldRead = demandScript.diffCalls[slowFrom]?.paths ?? [];
    await revealFromTree(target, "file-150");
    await until(() => header(target) !== undefined, "the revealed header");
    demandScript.holdDiff = false;
    releaseHeld();
    await until(() => renderedText().includes(`worktree-old ${target} 0`), "the revealed diff");
    const revealedOffset = headerOffset(target);
    const callsAtReveal = demandScript.diffCalls.length;

    // Files above it fill in while it stays put.
    await until(
      () => requested(callsAtReveal).includes(pathAt(140)),
      "files above the revealed one to be read",
    );
    await painted();
    const aboveRead = requested(callsAtReveal).filter((path) => path < target).length;
    const offsetAfterAbove = headerOffset(target);
    await clearFilter();

    // From the top, scroll fast and steadily while most of the review is unread.
    scrollport().scrollTop = 0;
    await painted();
    const readBeforeScroll = new Set(requested(slowFrom)).size;
    const step = 120;
    const frameTimes: number[] = [];
    let sampling = true;

    const sample = (time: number): void => {
      frameTimes.push(time);

      if (sampling) window.requestAnimationFrame(sample);
    };

    window.requestAnimationFrame(sample);
    const longTasks: number[] = [];

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration));
    });

    observer.observe({ type: "longtask" });
    const drift: number[] = [];
    const headerOnlyFrames: number[] = [];
    const extents = new Set<number>();
    let tracked: { readonly path: string; readonly offset: number } | undefined;
    let corrections = 0;

    for (let pass = 0; pass < 150; pass += 1) {
      const before = scrollport().scrollTop;
      scrollport().scrollTop = before + step;
      // Input scrolling moves the offset and fires its scroll event in the same
      // frame update; a script's write fires it a frame later, so say so now.
      scrollport().dispatchEvent(new Event("scroll"));
      const moved = scrollport().scrollTop - before;
      await painted();
      const items = onScreen();

      const now =
        tracked === undefined ? undefined : items.find((item) => item.path === tracked?.path);

      if (tracked !== undefined && now !== undefined && now.offset > now.height) {
        drift.push(Math.abs(now.offset - (tracked.offset - moved)));
      }

      if (scrollport().scrollTop !== before + moved) corrections += 1;
      const next = items.find((item) => item.offset > item.height);
      tracked = next === undefined ? undefined : { path: next.path, offset: next.offset };
      headerOnlyFrames.push(items.filter((item) => item.expanded && !item.body).length);
      extents.add(scrollport().scrollHeight);
    }

    sampling = false;
    observer.disconnect();
    const readAfterScroll = new Set(requested(slowFrom)).size;
    const intervals = frameTimes.slice(1).map((time, index) => time - (frameTimes[index] ?? time));
    await quiet();

    observations.incomplete = {
      heldRead,
      nextRead: demandScript.diffCalls[slowFrom + 1]?.paths ?? [],
      revealedOffset,
      aboveRead,
      offsetAfterAbove,
      fastScroll: {
        frames: headerOnlyFrames.length,
        pxPerFrame: step,
        filesReadBefore: readBeforeScroll,
        filesReadAfter: readAfterScroll,
        framesWithHeaderOnlyFiles: headerOnlyFrames.filter((count) => count > 0).length,
        mostHeaderOnlyFiles: Math.max(0, ...headerOnlyFrames),
        anchorDriftSamples: drift.length,
        anchorDriftMaxPx: Math.round(Math.max(0, ...drift) * 10) / 10,
        anchorCorrections: corrections,
        distinctExtents: extents.size,
        frameIntervalMs: {
          p50: percentile(intervals, 0.5),
          p95: percentile(intervals, 0.95),
          max: percentile(intervals, 1),
        },
        longTasksMs: longTasks,
      },
      distinct: new Set(requested(slowFrom)).size,
      repeated: requested(slowFrom).length - new Set(requested(slowFrom)).size,
      largestCall: largestCall(slowFrom),
      peak: demandScript.peak,
      headerOnlyAtRest: headerOnly(),
    };
    demandScript.latencyMs = 15;

    // A read for the old state still in flight when the scope changes never shows.
    scrollport().scrollTop = 0;
    await quiet();
    demandScript.holdDiff = true;
    demandScript.revision += 1;
    refreshVcs();
    await until(() => demandScript.heldDiffs.length > 0, "a held read for the new revision");
    render(3, { kind: "commit", oid: COMMIT_OID });
    demandScript.holdDiff = false;
    releaseHeld();
    await until(() => renderedText().includes("commit-old"), "the commit's own patch");
    await quiet();

    observations.scopeSwitch = {
      commitShown: renderedText().includes("commit-old"),
      commitReads: demandScript.diffCalls.filter((call) => call.scope === "commit").length,
      worktreeShown: renderedText().includes("worktree-old"),
      stackPaths: Array.from(container.querySelectorAll("[data-change-path]")).map(
        (node) => node.getAttribute("data-change-path") ?? "",
      ),
      peak: demandScript.peak,
    };

    return JSON.stringify({ kind: "observed", paths: PATHS.length, observations });
  } catch (error) {
    return JSON.stringify({
      kind: "failed",
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      observations,
      calls: demandScript.diffCalls.length,
      headers: Array.from(container.querySelectorAll("[data-change-path]")).map(
        (node) => node.getAttribute("data-change-path") ?? "",
      ),
    });
  } finally {
    root.unmount();
    queryClient.clear();
    container.remove();
  }
}

applyDisplayMode("light");
