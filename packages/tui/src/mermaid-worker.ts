import { parentPort } from "node:worker_threads";
import { renderMermaidASCII } from "beautiful-mermaid";
import { diagramRequests } from "./services/diagrams.ts";
import type { DiagramReply } from "./services/diagrams.ts";

const port = parentPort;

if (port === null) throw new Error("The diagram worker must run on a worker thread.");

port.on("message", (request) => {
  if (!diagramRequests.Check(request)) return;
  let reply: DiagramReply;

  try {
    const text = renderMermaidASCII(request.source, {
      colorMode: "none",
      paddingX: 3,
      paddingY: 2,
    });

    reply = { id: request.id, kind: "drawn", text };
  } catch {
    reply = { id: request.id, kind: "failed" };
  }

  port.postMessage(reply);
});
