import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { CursorExpired } from "@nyte-ai/core";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ipcDiagnostics, ipcFailure, ipcResult } from "../errors.ts";
import { callIpc } from "../ipc-call.ts";
import { decodeCallRequest, decodeWatchStart, decodeWatchStop } from "../ipc-inputs.ts";
import {
  CALL_CHANNEL,
  WATCH_EVENT_CHANNEL,
  WATCH_START_CHANNEL,
  WATCH_STOP_CHANNEL,
} from "../../shared/ipc.ts";
import type { CallRequest, CallOutput, WatchStartInput, WatchEnvelope } from "../../shared/ipc.ts";

const directory = process.argv[2];
assert.ok(directory);
app.setPath("userData", join(directory, "profile"));
app.setPath("sessionData", join(directory, "session"));
const operationCause = new TypeError("synthetic-secret-operation", {
  cause: new Error("synthetic-secret-nested-body"),
});
const watchCause = new Error("synthetic-secret-watch");
const startCause = new Error("synthetic-secret-start");

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
      return callIpc(() => {
        throw request.path === "host.fonts" ? operationCause : new CursorExpired(23);
      }, request);
    }
    const result = await ipcResult(() => {
      const decoded = decodeCallRequest(request);
      assert.equal(decoded.path, "host.pickWorkspace");
      return { kind: "cancelled" } satisfies CallOutput<"host.pickWorkspace">;
    });
    return result.ok ? { ...result, path: request.path } : result;
  });
  ipcMain.handle(WATCH_START_CHANNEL, (event, input: WatchStartInput) => {
    authorize(event);
    return ipcResult(() => {
      const start = decodeWatchStart(input);
      if (start.sessionId === "start-failure") throw startCause;
      const frames: WatchEnvelope[] = [
        {
          watchId: start.watchId,
          kind: "event",
          event: { seq: 0, kind: "activation_changed", activation: { kind: "active" } },
        },
        { watchId: start.watchId, kind: "ended", error: ipcFailure(watchCause) },
      ];
      for (const frame of frames) window.webContents.send(WATCH_EVENT_CHANNEL, frame);
    });
  });
  ipcMain.handle(WATCH_STOP_CHANNEL, (event, input: { readonly watchId: string }) => {
    authorize(event);
    return ipcResult(() => {
      decodeWatchStop(input);
    });
  });
  try {
    await window.loadFile(join(directory, "index.html"));
    const observed: unknown = await window.webContents.executeJavaScript("TransportTest.run()");
    assert.ok(Value.Check(Type.Array(Type.String(), { minItems: 3, maxItems: 3 }), observed));
    assert.equal(ipcDiagnostics.size, 3);
    assert.equal(ipcDiagnostics.get(observed[0] ?? ""), operationCause);
    assert.equal(ipcDiagnostics.get(observed[1] ?? ""), watchCause);
    assert.equal(ipcDiagnostics.get(observed[2] ?? ""), startCause);
    await writeFile(join(directory, "result.txt"), "passed");
    app.exit(0);
  } catch (cause) {
    await writeFile(join(directory, "result.txt"), String(cause));
    app.exit(1);
  }
});
