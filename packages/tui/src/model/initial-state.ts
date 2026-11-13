import type { ResolvedSettings } from "../lib/settings-schema.ts";
import { indexSlash } from "./commands.ts";
import { NO_PARTS } from "./draft.ts";
import type { BlankChat, Draft, State, TerminalFacts } from "./state.ts";

interface Bootstrap {
  readonly cwd: string;
  readonly settings: ResolvedSettings;
  readonly terminal: TerminalFacts;
  readonly chat: BlankChat | null;
}

const EMPTY_DRAFT: Draft = { text: "", cursor: 0, row: "only", parts: NO_PARTS };

export function initialState(bootstrap: Bootstrap): State {
  return indexSlash({
    facts: {
      host: "opening",
      health: { kind: "connecting" },
      chat: bootstrap.chat,
      catalog: { generation: -1, catalog: null },
      hostSettings: [],
      slash: [],
      folderCatalog: null,
      settings: bootstrap.settings,
      tasks: [],
      shells: [],
      workspace: { cwd: bootstrap.cwd, branch: null, dirty: false, mentions: null },
      terminal: bootstrap.terminal,
      focused: true,
    },
    local: {
      draft: EMPTY_DRAFT,
      completion: { kind: "closed", dismissed: null },
      editing: null,
      dialogs: [],
      question: { dismissed: null, highlighted: 0, drafts: new Map() },
      approval: { part: null, highlighted: 0, sending: null },
      notice: null,
      failures: [],
      pending: [],
      handbacks: {},
      drafts: {},
      edits: {},
      history: null,
      escapeArmedAt: null,
      transcript: {
        following: true,
        window: { kind: "tail" },
        toolOutput: "collapsed",
        disclosures: new Set(),
        wholeTools: new Map(),
      },
      submissions: [],
      settlingTrust: [],
      sequence: 0,
      pasteGeneration: 0,
      pasting: 0,
      sendAfterPaste: null,
      watchedRun: null,
      move: null,
      preview: null,
    },
  });
}
