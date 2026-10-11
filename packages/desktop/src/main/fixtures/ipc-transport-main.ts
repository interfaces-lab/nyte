import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { SdkError } from "@nyte-ai/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ipcDiagnostics, ipcResult } from "../errors.ts";
import { callIpc } from "../ipc-call.ts";
import { decodeCallRequest } from "../ipc-inputs.ts";
import { CALL_CHANNEL } from "../../shared/ipc.ts";
import type { CallRequest, CallOutput } from "../../shared/ipc.ts";

const directory = process.argv[2];

assert.ok(directory);

app.setPath("userData", join(directory, "profile"));

app.setPath("sessionData", join(directory, "session"));

const operationCause = new TypeError("synthetic-secret-operation", {
  cause: new Error("synthetic-secret-nested-body"),
});

void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(directory, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const authorize = (event: Electron.IpcMainInvokeEvent): void => {
    assert.equal(event.sender, window.webContents);
    assert.equal(event.senderFrame, window.webContents.mainFrame);
  };

  ipcMain.handle(CALL_CHANNEL, async (event, request: CallRequest) => {
    authorize(event);

    if (request.path === "host.fonts" || request.path === "host.state") {
      return callIpc(
        () => {
          throw request.path === "host.fonts"
            ? operationCause
            : new SdkError("stale", "The host moved on.");
        },
        1,
        request,
      );
    }

    const result = await ipcResult(() => {
      const decoded = decodeCallRequest(request);
      assert.equal(decoded.path, "host.pickWorkspace");

      return { kind: "cancelled" } satisfies CallOutput<"host.pickWorkspace">;
    });

    return result.ok ? { ...result, path: request.path } : result;
  });

  try {
    await window.loadFile(join(directory, "index.html"));
    const observed: unknown = await window.webContents.executeJavaScript("TransportTest.run()");
    assert.ok(Value.Check(Type.Array(Type.String(), { minItems: 1, maxItems: 1 }), observed));
    assert.equal(ipcDiagnostics.size, 1);
    assert.equal(ipcDiagnostics.get(observed[0] ?? ""), operationCause);
    await writeFile(join(directory, "result.txt"), "passed");
    app.exit(0);
  } catch (cause) {
    await writeFile(join(directory, "result.txt"), String(cause));
    app.exit(1);
  }
});
