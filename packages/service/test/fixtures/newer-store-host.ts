import { parentPort } from "node:worker_threads";

const parent = parentPort;

if (parent === null) throw new Error("newer-store-host.ts runs as a host thread.");

parent.on("message", () => {
  parent.postMessage({
    kind: "store-newer",
    message: "This data was updated by a newer version of Nyte.",
  });
});
