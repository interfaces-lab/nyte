import "../../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { WorkspaceInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { keys, queryClient } from "../../data/query-client.ts";
import { SubagentCitation } from "./subagent-call.tsx";
import "../../theme/tokens.stylex.ts";
import "../../theme/global.css";
import { sessionRow } from "../../../test/view-fixtures.ts";
import { sessionList } from "../../data/directory.ts";
import { installScripted, scriptedConnection } from "../../../test/scripted-connection.ts";

declare global {
  interface Window {
    readonly rendererCapture: (name: string) => void;
  }
}

const FOLDER = asId<"workspace">("folder");

const WORKTREE = asId<"workspace">("worktree");

const BRANCH = "nyte/fix-login-3f2a1b9c";

function workspace(change: Partial<WorkspaceInfo>): WorkspaceInfo {
  return {
    id: FOLDER,
    target: { kind: "local", path: "/work/nyte" },
    identity: asId("folder"),
    availability: { kind: "available" },
    projectResources: true,
    trusted: true,
    projectSources: [],
    addedBy: asId("local"),
    writers: [],
    isolation: null,
    ...change,
  };
}

const child = sessionRow("fixer", {
  name: "Fix login",
  parent: asId("parent"),
  workspace: WORKTREE,
});

installScripted(scriptedConnection({ sessions: [child] }));

function Stage(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delay={0} closeDelay={0} timeout={0}>
        <p>
          The login fix runs in <SubagentCitation session={child.id} label="Fix login" />.
        </p>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

let renderFailure: unknown;

async function until<T>(read: () => T | null | undefined, what: string): Promise<T> {
  const deadline = performance.now() + 5_000;

  for (;;) {
    if (renderFailure !== undefined) throw renderFailure;
    const value = read();

    if (value !== null && value !== undefined) return value;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await nextFrame();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function capture(name: string): Promise<void> {
  const captured = new Promise((resolve) =>
    document.addEventListener("renderer-captured", resolve, { once: true }),
  );

  window.rendererCapture(name);
  await captured;
}

export async function run(): Promise<string> {
  const failures: string[] = [];
  const stage = document.createElement("div");
  stage.style.cssText = "position:relative;width:420px;height:200px;padding:24px;";
  document.body.append(stage);
  queryClient.setQueryData(keys.workspaces, [
    workspace({}),
    workspace({
      id: WORKTREE,
      target: { kind: "local", path: "/home/ada/.nyte/worktrees/nyte/fix-login-3f2a1b9c" },
      identity: asId("worktree"),
      isolation: {
        kind: "worktree",
        source: FOLDER,
        session: child.id,
        branch: BRANCH,
        base: "c0ffee",
      },
    }),
  ]);

  const listing = sessionList("all").subscribe(() => undefined);
  await sessionList("all").until(() => true);

  const root = createRoot(stage, {
    onUncaughtError: (error) => {
      renderFailure = error;
    },
  });

  flushSync(() => root.render(<Stage />));

  const link = await until(() => stage.querySelector("a[data-citation='agent']"), "the citation");
  link.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }));
  link.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
  link.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

  const card = await until(
    () => document.querySelector("[data-side='bottom'], [role='dialog']"),
    "the preview card",
  );

  const place = await until(
    () => card.querySelector("span[title$='fix-login-3f2a1b9c']"),
    "the subagent's place",
  );

  if (place.textContent !== BRANCH)
    failures.push(`the subagent's place reads ${place.textContent}, not its branch`);

  await nextFrame();
  await capture("worktree-citation-light");
  applyDisplayMode("dark");
  await nextFrame();
  await capture("worktree-citation-dark");
  applyDisplayMode("light");

  flushSync(() => root.unmount());
  listing();
  stage.remove();

  return failures.length === 0 ? "passed" : failures.join("\n");
}
