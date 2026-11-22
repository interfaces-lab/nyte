# 05 Local hands

A person's Mac as a worker, so a cloud chat's agent can run a command there and keep going. Modelled on Devin's Local Hands: "Your computer does not replace the session's VM. Devin keeps its VM and gets a second set of tools that run on your machine" (docs.devin.ai/work-with-devin/local-hands).

## Connecting a Mac

1. In a cloud chat, or in Settings › Server under the cloud host, the person chooses **Connect This Mac**. The cloud host shows a single-use code, valid 10 minutes.
2. On the Mac: `nyte worker connect <code>`, or the desktop app does it for them. The worker registers as `hands:<principal>`, bound to the person who made the code.
3. The desktop app runs the worker while it is open. A Mac that is closed or asleep has no worker, and the chat carries on without it.

Only the person who made the code can bind a Mac to their own principal. Nobody connects a Mac on someone else's behalf. Devin works the same way: "Devin issues the pairing code to the session owner's account."

## Routing

```ts
const sender = await invocation.sender();          // the person who sent the latest message
const hands = workers.get(`hands:${sender}`);
if (hands === undefined) return text("<name>'s Mac isn't connected.");
```

- `ToolInvocation.sender()` and the principal on every send receipt come from the `local_bash` work already staged in this worktree.
- After a teammate takes a chat over and sends a message, the next `local_bash` goes to their Mac.

## Tool

v1 has one tool, `local_bash`. Its parameters and output match `bash`, and its footer names the Mac:

```
ran in my-repo
[exit code 0 on Ada's MacBook]
```

- It runs in the folder the person chose when connecting. The default is the repository's checkout on that Mac.
- File tools on the Mac (`local_read`, `local_write`) wait until people ask for them.

## Consent

- `local_bash` is classed as `shell`, so the chat's approval policy holds it like any command.
- The desktop app also shows the person each command before it runs, with **Allow once**, **Allow for this chat** and **Deny**. A Mac never runs a command for anyone but its own person. A request for any other principal is refused with `denied`.
- Turning the worker off in the desktop app stops the current command and refuses new ones at once.

## What replaces the client-action version

Delete these once this lands; the Mac worker replaces each one:

- `packages/plugin/src/machine-bridge.ts`.
- The `principal` parameter on `ClientActions` (`packages/plugin/src/browser-client.ts`).
- `findOffering` and principal routing in `performOffered` (`packages/host/src/serve/clients.ts`).

Keep the send-receipt principal and `ToolInvocation.sender()`.

## Acceptance

Reuse the end-to-end test from the client-action proof, with the cloud host and two Mac workers:

- Ada sends a message, and `local_bash` runs in Ada's checkout with the right exit code.
- Ben sends the next one, and it runs on Ben's Mac.
- Carol has no Mac connected, and the tool says so. The run continues.
- A worker that receives a request for someone else refuses it with `denied`.
- Closing Ada's laptop mid-command ends the call with the process lost. The chat continues.
