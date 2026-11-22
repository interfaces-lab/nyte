#!/usr/bin/env node
"use strict";

let buffer = Buffer.alloc(0);
let root = "";
const seen = [];

function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
  process.stdout.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
  process.stdout.write(body);
}

function note(text) {
  seen.push({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    severity: 4,
    message: text,
  });
  send({
    method: "textDocument/publishDiagnostics",
    params: { uri: `${root}/probe.go`, diagnostics: seen },
  });
}

function receive(message) {
  if (message.method === "initialize") {
    root = message.params.rootUri;
    send({
      id: message.id,
      result: {
        capabilities: {
          textDocumentSync: 2,
          hoverProvider: true,
          codeActionProvider: true,
          completionProvider: {},
          renameProvider: true,
        },
        serverInfo: { name: "scripted", version: "1.0.0" },
      },
    });
    return;
  }

  if (message.method === "initialized") {
    send({
      method: "$/progress",
      params: { token: "index", value: { kind: "begin", title: "Indexing", percentage: 40 } },
    });
    send({
      method: "textDocument/publishDiagnostics",
      params: {
        uri: `${root}/main.go`,
        diagnostics: [
          {
            range: { start: { line: 2, character: 5 }, end: { line: 2, character: 9 } },
            severity: 2,
            code: "probe",
            source: "scripted",
            message: "main is lonely",
          },
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
            severity: 2,
            message: "elsewhere",
          },
        ],
      },
    });
    send({
      id: "edit-1",
      method: "workspace/applyEdit",
      params: { edit: { changes: { [`${root}/main.go`]: [] } } },
    });
    return;
  }

  if (message.id === "edit-1") return note(`applyEdit ${JSON.stringify(message.result)}`);

  if (message.method === "$/cancelRequest") {
    send({ id: message.params.id, error: { code: -32800, message: "Cancelled." } });
    return note(`cancel ${message.params.id}`);
  }

  if (message.method === "textDocument/completion") {
    if (message.params.position.line === 0) return note("completion pending");
    send({ id: message.id, result: [{ label: "answered" }] });
    return;
  }

  if (message.method === "textDocument/codeAction") {
    send({ id: message.id, result: [] });
    return note(`codeAction ${JSON.stringify(message.params.context)}`);
  }

  if (message.method === "textDocument/rename") {
    send({
      id: message.id,
      result: { documentChanges: [{ kind: "create", uri: `${root}/new.go` }] },
    });
    return;
  }

  if (message.method === "shutdown") {
    send({ id: message.id, result: null });
    return;
  }

  if (message.method === "exit") process.exit(0);

  if (message.id !== undefined && message.method !== undefined)
    send({ id: message.id, result: null });
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");

    if (end < 0) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);

    if (buffer.byteLength < end + 4 + length) return;
    const body = buffer.subarray(end + 4, end + 4 + length).toString();
    buffer = buffer.subarray(end + 4 + length);
    receive(JSON.parse(body));
  }
});
