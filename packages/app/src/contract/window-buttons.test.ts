import { expect, test } from "vitest";
import { macOSWindowButtonHeight } from "./window-buttons.ts";

test.each([
  { macOS: "15 Sequoia", darwin: "24.6.0", height: 16 },
  { macOS: "26 Tahoe", darwin: "25.0.0", height: 14 },
  { macOS: "26.4", darwin: "25.4.0", height: 14 },
  { macOS: "after 26", darwin: "26.0.0", height: 14 },
  { macOS: "this machine", darwin: "27.2.0", height: 14 },
])("Darwin $darwin, macOS $macOS: $height pt", (row) => {
  expect(macOSWindowButtonHeight(row.darwin)).toBe(row.height);
});

test.each([
  { productVersion: "16.0", build: "an old-SDK build", height: 16 },
  { productVersion: "26.0", build: "a current-SDK build", height: 14 },
])(
  "the old path's input on macOS 26 from $build, product version $productVersion, gives $height pt",
  (row) => {
    expect(macOSWindowButtonHeight(row.productVersion)).toBe(row.height);
  },
);
