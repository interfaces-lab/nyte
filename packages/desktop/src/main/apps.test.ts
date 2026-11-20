import { expect, test } from "vitest";
import type { DesktopApp } from "@nyte-ai/app/contract/desktop-app.ts";
import { windowsAppDetails } from "./apps.ts";

const EXECUTABLE = "C:\\Program Files\\Nyte\\Nyte.exe";

test.each<{ readonly app: DesktopApp; readonly appId: string }>([
  { app: "nyte", appId: "ai.nyte.desktop" },
  { app: "code", appId: "ai.nyte.desktop.code" },
  { app: "studio", appId: "ai.nyte.desktop.studio" },
])("$app windows take their own taskbar entry on Windows", (row) => {
  expect(windowsAppDetails(row.app, "ai.nyte.desktop", EXECUTABLE)).toEqual({
    appId: row.appId,
    appIconPath: EXECUTABLE,
    appIconIndex: 0,
  });
});
