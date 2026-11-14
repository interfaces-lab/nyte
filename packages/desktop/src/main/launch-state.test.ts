import { expect, test } from "vitest";
import { openingFrame, windowsAfterClose } from "./launch-state.ts";
import type { OpeningFrame, WindowFrame } from "./launch-state.ts";

const own: WindowFrame = {
  bounds: { x: 10, y: 20, width: 900, height: 700 },
  maximized: true,
  fullscreen: false,
};

const last: WindowFrame = {
  bounds: { x: 30, y: 40, width: 1000, height: 600 },
  maximized: false,
  fullscreen: true,
};

const offScreen = (frame: WindowFrame): WindowFrame => ({
  ...frame,
  bounds: { ...frame.bounds, x: -5000 },
});

test.each<{
  readonly name: string;
  readonly own: WindowFrame | undefined;
  readonly last: WindowFrame | undefined;
  readonly first: boolean;
  readonly frame: OpeningFrame;
}>([
  { name: "a window on a screen reopens where it was", own, last, first: false, frame: own },
  {
    name: "a window off every screen with no last frame opens at the default size",
    own: offScreen(own),
    last: undefined,
    first: true,
    frame: { bounds: { width: 1280, height: 800 }, maximized: false, fullscreen: false },
  },
  {
    name: "a new window with no last frame opens at the default size",
    own: undefined,
    last: undefined,
    first: true,
    frame: { bounds: { width: 1280, height: 800 }, maximized: false, fullscreen: false },
  },
  {
    name: "the launch's first new window takes the last frame",
    own: undefined,
    last,
    first: true,
    frame: last,
  },
  {
    name: "a later new window takes only the last frame's size",
    own: undefined,
    last,
    first: false,
    frame: { bounds: { width: 1000, height: 600 }, maximized: false, fullscreen: false },
  },
  {
    name: "the first new window takes only the size of a last frame off every screen",
    own: undefined,
    last: offScreen(last),
    first: true,
    frame: { bounds: { width: 1000, height: 600 }, maximized: false, fullscreen: false },
  },
  {
    name: "a window off every screen takes only the last frame's size, even first",
    own: offScreen(own),
    last,
    first: true,
    frame: { bounds: { width: 1000, height: 600 }, maximized: false, fullscreen: false },
  },
])("opening: $name", (row) => {
  expect(
    openingFrame({
      own: row.own,
      last: row.last,
      first: row.first,
      onScreen: (bounds) => bounds.x > -1000,
    }),
  ).toEqual(row.frame);
});

test.each<{
  readonly name: string;
  readonly quitting: boolean;
  readonly remaining: number;
  readonly kept: readonly string[] | undefined;
}>([
  { name: "quitting keeps every window", quitting: true, remaining: 1, kept: undefined },
  { name: "closing the last window keeps it", quitting: false, remaining: 0, kept: undefined },
  { name: "quitting from the last window keeps it", quitting: true, remaining: 0, kept: undefined },
  { name: "closing another window drops it", quitting: false, remaining: 1, kept: ["a", "c"] },
])("closing: $name", (row) => {
  expect(
    windowsAfterClose(["a", "b", "c"], "b", { quitting: row.quitting, remaining: row.remaining }),
  ).toEqual(row.kept);
});
