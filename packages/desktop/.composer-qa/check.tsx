/**
 * The composer under Chromium: a Vite build of this page runs hidden inside
 * Electron (`run.cjs`) and drives the real editor with input events. It stubs
 * only the bridge the composer reads at import (`window.nyte`, in index.html).
 */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import {
  ComposerFrame,
  readComposerImageAttachments,
} from "../src/renderer/src/conversation/composer.tsx";
import type { ComposerImageAttachment } from "../src/renderer/src/conversation/composer.tsx";
import type { ComposerDocumentState } from "../src/renderer/src/conversation/composer-document.ts";
import { composerPromptText } from "../src/renderer/src/conversation/composer-send.ts";
import { UserMessageText } from "../src/renderer/src/conversation/message-content.tsx";
import "../src/renderer/src/theme/tokens.css";

const files = [
  {
    path: "/project/a file.ts",
    url: "file:///project/a%20file.ts",
    label: "a file.ts",
    displayPath: "a file.ts",
  },
  { path: "/project/src/", url: "file:///project/src/", label: "src/", displayPath: "src/" },
];
const client = new QueryClient();
const EMPTY: ComposerDocumentState = { text: "", selectionStart: 0, selectionEnd: 0 };

function Check() {
  const [document, setDocument] = useState<ComposerDocumentState>(EMPTY);
  const [attachments, setAttachments] = useState<readonly ComposerImageAttachment[]>([]);
  const [sent, setSent] = useState("");
  const [lane, setLane] = useState("");
  const [surface, setSurface] = useState<"new-chat" | "follow-up">("new-chat");
  const [busy, setBusy] = useState(false);
  const [rejectNext, setRejectNext] = useState(false);
  return (
    <QueryClientProvider client={client}>
      <button
        id="toggle"
        onClick={() => setSurface(surface === "new-chat" ? "follow-up" : "new-chat")}
      >
        Toggle surface
      </button>
      <button id="busy" onClick={() => setBusy((current) => !current)}>
        Toggle busy
      </button>
      <button id="reject" onClick={() => setRejectNext(true)}>
        Reject next send
      </button>
      <button
        id="restore"
        onClick={() =>
          setDocument({
            text: "Review @file:///project/a%20file.ts carefully",
            selectionStart: 7,
            selectionEnd: 7,
          })
        }
      >
        Restore draft
      </button>
      <button id="refocus">Focus target</button>
      <ComposerFrame
        document={document}
        surface={surface}
        busy={busy}
        onAbort={() => setSent("aborted")}
        placeholder="Ask anything"
        onDocumentChange={setDocument}
        onSubmit={async (submission, submittedLane) => {
          await Promise.resolve();
          if (rejectNext) {
            setRejectNext(false);
            return false;
          }
          setSent(composerPromptText(submission.text.trim(), submission.references));
          setLane(submittedLane);
          setDocument(EMPTY);
          setAttachments([]);
          return true;
        }}
        attachments={attachments}
        onFilesSelected={async (picked) =>
          setAttachments((await readComposerImageAttachments(picked)).attachments)
        }
        onAttachmentRemove={(id) =>
          setAttachments((current) => current.filter((item) => item.id !== id))
        }
        mentionFiles={{ status: "ready", data: files }}
        suggestionCatalog={{
          status: "ready",
          data: {
            plugins: [],
            commands: [],
            settings: [],
            skills: [
              {
                name: "review",
                description: "Review code",
                content: "Review carefully.",
                filePath: "/skills/review/SKILL.md",
              },
            ],
          },
        }}
        model={<span>Model</span>}
        autoFocus
      />
      <pre id="view">{JSON.stringify(document)}</pre>
      <pre id="value">{document.text}</pre>
      <pre id="sent">{sent}</pre>
      <pre id="lane">{lane}</pre>
      <section id="transcript">
        <UserMessageText text={sent} />
      </section>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Check />);
