import { expect, test } from "vitest";
import type { SessionId } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { activeTab, initialWindow, reduce } from "./model.ts";
import type { Place, Tab, WindowAction, WindowState } from "./model.ts";
import { adoptLocation, followFolder, routeFor } from "./route-sync.ts";
import type { FolderFollow } from "./route-sync.ts";

let lastId = 0;

function createId(): string {
  lastId += 1;

  return `t${String(lastId)}`;
}

const chat = (id: string): Place => ({ kind: "session", sessionId: asId<"session">(id) });

const customize = (section: string | undefined): Place => ({
  kind: "customize",
  section,
  sessionId: undefined,
});

const project: Place = { kind: "project", projectId: asId<"project">("p") };

function showing(...places: readonly Place[]): WindowState {
  return places.reduce(
    (state, place) => reduce(state, { kind: "open", place, target: "permanent" }, createId),
    initialWindow("t0", createId),
  );
}

test.each([
  [
    "a customize tab shown at another section",
    showing(customize("skills")),
    customize("plugins"),
    { kind: "page-section", section: "plugins" },
  ],
  [
    "a customize tab shown at its default section",
    showing(customize(undefined)),
    customize("plugins"),
    undefined,
  ],
  [
    "a customize tab shown at the same section",
    showing(customize("skills")),
    customize("skills"),
    undefined,
  ],
  [
    "a customize tab shown at a chat",
    showing(customize("skills")),
    chat("x"),
    { kind: "open", place: chat("x"), target: "permanent" },
  ],
  ["the place the tab shows", showing(chat("x")), chat("x"), undefined],
  [
    "a blank tab shown at a chat",
    showing(),
    chat("x"),
    { kind: "open", place: chat("x"), target: "permanent" },
  ],
  [
    "a chat tab shown at customize",
    showing(chat("x")),
    customize("skills"),
    { kind: "open", place: customize("skills"), target: "permanent" },
  ],
  [
    "a chat tab shown at a project",
    showing(chat("x")),
    project,
    { kind: "open", place: project, target: "permanent" },
  ],
  ["settings", showing(chat("x")), undefined, undefined],
] satisfies readonly (readonly [
  string,
  WindowState,
  Place | undefined,
  WindowAction | undefined,
])[])("adopt: %s", (_name, state, location, action) => {
  expect(adoptLocation(state, location)).toEqual(action);
});

test.each([
  ["the location shows the tab's place", showing(chat("x")), chat("x"), undefined],
  ["the location shows another chat", showing(chat("x")), chat("y"), chat("x")],
  [
    "the location shows customize at another section",
    showing(customize("skills")),
    customize("plugins"),
    customize("skills"),
  ],
  ["a blank tab at the root", showing(), { kind: "blank" }, undefined],
  ["settings", showing(chat("x")), undefined, undefined],
] satisfies readonly (readonly [string, WindowState, Place | undefined, Place | undefined])[])(
  "route: %s",
  (_name, state, location, place) => {
    expect(routeFor(state, location)).toEqual(place);
  },
);

const START: FolderFollow = { followed: "", wanted: null };

const FOLDERS = new Map<string, string | null>([
  ["a", "/a"],
  ["b", "/b"],
  ["home", null],
]);

const folder = (id: SessionId): string | null | undefined => FOLDERS.get(id);

const chatTab = activeTab(showing(chat("a")));

test.each([
  [
    "a chat with a known folder",
    START,
    chatTab,
    { followed: `${chatTab.id}:a`, wanted: "/a" },
    { kind: "activate", folder: "/a" },
  ],
  [
    "a chat in no folder",
    START,
    activeTab(showing(chat("home"))),
    undefined,
    { kind: "activate", folder: null },
  ],
  [
    "a chat whose folder is not known yet",
    START,
    activeTab(showing(chat("unknown"))),
    START,
    { kind: "none" },
  ],
  [
    "the same tab and chat again",
    { followed: `${chatTab.id}:a`, wanted: "/a" },
    chatTab,
    { followed: `${chatTab.id}:a`, wanted: "/a" },
    { kind: "none" },
  ],
  [
    "the same chat in another tab",
    { followed: "other:a", wanted: "/a" },
    chatTab,
    { followed: `${chatTab.id}:a`, wanted: "/a" },
    { kind: "activate", folder: "/a" },
  ],
  [
    "a blank tab",
    { followed: "other:a", wanted: "/a" },
    activeTab(showing()),
    undefined,
    { kind: "none" },
  ],
  [
    "a page",
    { followed: "other:a", wanted: "/a" },
    activeTab(showing(customize("skills"))),
    undefined,
    { kind: "none" },
  ],
] satisfies readonly (readonly [
  string,
  FolderFollow,
  Tab,
  FolderFollow | undefined,
  { readonly kind: "none" } | { readonly kind: "activate"; readonly folder: string | null },
])[])("follow: %s", (_name, previous, tab, next, step) => {
  const followed = followFolder(previous, tab, folder);

  expect(followed.step).toEqual(step);

  if (next !== undefined) expect(followed.next).toEqual(next);
});

test("follow: a page or blank tab is remembered without touching the wanted folder", () => {
  const blank = activeTab(showing());
  const page = activeTab(showing(customize("skills")));
  const previous = { followed: "other:a", wanted: "/a" };

  expect([
    followFolder(previous, blank, folder).next,
    followFolder(previous, page, folder).next,
  ]).toEqual([
    { followed: `${blank.id}:blank`, wanted: "/a" },
    { followed: `${page.id}:customize`, wanted: "/a" },
  ]);
});

test("follow: switching A, B, then A again leaves A as the folder wanted last", () => {
  const tabs = [chat("a"), chat("b"), chat("a")].map((place) => activeTab(showing(place)));

  const steps = tabs.reduce<{
    readonly follow: FolderFollow;
    readonly asked: readonly (string | null)[];
  }>(
    (run, tab) => {
      const followed = followFolder(run.follow, tab, folder);

      return {
        follow: followed.next,
        asked: followed.step.kind === "activate" ? [...run.asked, followed.step.folder] : run.asked,
      };
    },
    { follow: START, asked: [] },
  );

  expect(steps.asked).toEqual(["/a", "/b", "/a"]);
  expect(steps.follow.wanted).toBe("/a");
});
