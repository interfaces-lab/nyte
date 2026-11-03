import { expect, test } from "bun:test";
import { encode } from "../../src/lib/program-status.ts";
import type { ProgramStatus } from "../../src/lib/program-status.ts";

const CASES: readonly (readonly [string, ProgramStatus, string])[] = [
  [
    "idle without a title",
    { state: "idle", title: null, msg: "Ready" },
    "\u001B]7501;state=idle:app=nyte:msg=UmVhZHk=\u001B\\",
  ],
  [
    "working with the chat's title",
    { state: "working", title: "Fix the build", msg: "Working" },
    "\u001B]7501;state=working:app=nyte:title=Rml4IHRoZSBidWlsZA==:msg=V29ya2luZw==\u001B\\",
  ],
  [
    "blocked on a permission",
    { state: "blocked", kind: "permission", title: null, msg: "Run bash: rm -rf dist" },
    "\u001B]7501;state=blocked:kind=permission:app=nyte:msg=UnVuIGJhc2g6IHJtIC1yZiBkaXN0\u001B\\",
  ],
  [
    "blocked on a question",
    { state: "blocked", kind: "question", title: "Fix the build", msg: "Pick a branch" },
    "\u001B]7501;state=blocked:kind=question:app=nyte:title=Rml4IHRoZSBidWlsZA==:msg=UGljayBhIGJyYW5jaA==\u001B\\",
  ],
  [
    "done",
    { state: "done", title: null, msg: "Finished" },
    "\u001B]7501;state=done:app=nyte:msg=RmluaXNoZWQ=\u001B\\",
  ],
  [
    "an error's lines folded into one",
    { state: "error", title: null, msg: "Provider overloaded:\n\tretry later" },
    "\u001B]7501;state=error:app=nyte:msg=UHJvdmlkZXIgb3ZlcmxvYWRlZDogcmV0cnkgbGF0ZXI=\u001B\\",
  ],
  [
    "UTF-8 text and a blank title",
    { state: "idle", title: "  ", msg: "Héllo — ünïcode" },
    "\u001B]7501;state=idle:app=nyte:msg=SMOpbGxvIOKAlCDDvG7Dr2NvZGU=\u001B\\",
  ],
];

test.each(CASES)("OSC 7501 encodes %s", (_name, status, bytes) => {
  expect(encode(status)).toBe(bytes);
});
