import { asId } from "@nyte-ai/schema";
import type { Execution, SessionInfo } from "@nyte-ai/sdk";
import { props } from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { SessionRow } from "@nyte-ai/app/chrome/sidebar-rows.tsx";
import type { RailRows } from "@nyte-ai/app/chrome/sidebar-rows.tsx";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { ComposerFrame } from "@nyte-ai/app/conversation/composer-frame.tsx";
import { composerStyles } from "@nyte-ai/app/conversation/composer.stylex.ts";
import { ModelPicker } from "@nyte-ai/app/conversation/model-picker.tsx";
import { SubagentSessionsProvider } from "@nyte-ai/app/conversation/subagent-sessions.ts";
import { QuestionTray } from "@nyte-ai/app/conversation/tray/questions.tsx";
import { QuestionDockContext } from "@nyte-ai/app/conversation/tray/questions-state.ts";
import type { QuestionDock } from "@nyte-ai/app/conversation/tray/questions-state.ts";
import type { DesktopModelOption } from "@nyte-ai/app/catalog.ts";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Row as NavRow } from "@nyte-ai/ui/row";
import { RUN_VIEW, SUBAGENTS } from "../../../src/messages/build";
import { modelCatalog } from "../../../src/shell/fixtures";
import { Row } from "../app/transcript";
import type { Staged } from "../app/staging";

export const size = { width: 1440, height: 900, titlebar: 44, sidebar: 264 } as const;

const noop = () => {};
const submitNothing = () => false;
const noSuggestions = { status: "ready", data: { commands: [], skills: [] } } as const;
const noFiles = { status: "ready", data: [] } as const;
const workspace = asId<"workspace">("lab");

const live: Execution = { kind: "live", run: RUN_VIEW, phase: "executing", stopping: false };
const asking: Execution = { kind: "waiting", run: RUN_VIEW, on: { kind: "part", part: asId<"part">("film-question") } };
const idle: Execution = { kind: "idle", lastRun: null };

function session(id: string, name: string, execution: Execution, minutesAgo: number): SessionInfo {
  const at = Date.now() - minutesAgo * 60_000;
  return {
    id: asId<"session">(id),
    name,
    parent: null,
    call: null,
    workspace,
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: [{ name: asId<"head">("main"), tip: { kind: "start" }, stack: null, execution, unread: false }],
    createdAt: at,
    lastActivityAt: at,
  } as SessionInfo;
}

export type Mark = "working" | "waiting" | "done";

function sessions(mark: Mark, waited: number) {
  return [
    session("film", "Migrate stored runs", mark === "working" ? live : mark === "waiting" ? asking : idle, waited),
    session("titlebar", "Review titlebar alignment", live, 3),
    session("trust", "Confirm workspace trust copy", asking, 50),
    session("docs", "Docs deployment", idle, 240),
    session("dialog", "Dialog surface migration", idle, 1500),
  ];
}

function rail(mark: Mark): RailRows {
  return {
    openWorkspace: workspace,
    activeSessionId: asId<"session">("film"),
    unavailable: new Set(),
    repository: undefined,
    working: new Set([asId<"session">("titlebar"), ...(mark === "working" ? [asId<"session">("film")] : [])]),
    showUpdated: true,
    open: noop,
    rename: noop,
    pin: noop,
    archive: noop,
    remove: noop,
    openDraft: noop,
    removeDraft: noop,
  };
}

function Titlebar({ title }: { readonly title: string }) {
  return (
    <div style={{ height: size.titlebar, display: "flex", alignItems: "center", gap: 18, padding: "0 16px", borderBottom: "1px solid rgb(255 255 255 / 0.06)" }}>
      <div style={{ display: "flex", gap: 8 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((colour) => (
          <span key={colour} style={{ width: 12, height: 12, borderRadius: 6, background: colour }} />
        ))}
      </div>
      <div style={{ width: size.sidebar - 100 }} />
      <div style={{ fontSize: 13, color: "rgb(255 255 255 / 0.55)", display: "flex", gap: 6 }}>
        <span>nyte</span>
        <span style={{ opacity: 0.5 }}>/</span>
        <span style={{ color: "rgb(255 255 255 / 0.85)" }}>{title}</span>
      </div>
    </div>
  );
}

function Nav({ icon, label, trailing }: { readonly icon: IconName; readonly label: string; readonly trailing?: ReactNode }) {
  return (
    <NavRow variant="nav" xstyle={sidebarStyles.navRow}>
      <NavRow.Leading xstyle={sidebarStyles.navLeading}>
        <Icon name={icon} size={14} />
      </NavRow.Leading>
      <NavRow.Label>{label}</NavRow.Label>
      {trailing}
    </NavRow>
  );
}

function Sidebar({ mark, waited }: { readonly mark: Mark; readonly waited: number }) {
  const rows = rail(mark);
  return (
    <div style={{ width: size.sidebar, flexShrink: 0, padding: "10px 8px", borderRight: "1px solid rgb(255 255 255 / 0.06)", background: "rgb(0 0 0 / 0.12)", display: "flex", flexDirection: "column", gap: 2 }}>
      <Nav icon="new-chat" label="New Chat" trailing={<span {...props(sidebarStyles.shortcutSlot, sidebarStyles.shortcutPersistent)}><Kbd keys={["⌘", "N"]} /></span>} />
      <Nav icon="search" label="Search" />
      <Nav icon="customize" label="Customize" />
      <Nav icon="settings" label="Settings" trailing={<Icon name="chevron-right" size={14} />} />
      <div style={{ height: 18 }} />
      <span {...props(sidebarStyles.sectionLabel)} style={{ padding: "0 10px 6px" }}>
        Chats
      </span>
      {sessions(mark, waited).map((item) => (
        <SessionRow key={item.id} session={item} place={{ workspace, path: "/Users/lab/nyte" }} layoutEnabled={false} rail={rows} />
      ))}
    </div>
  );
}

export interface Composer {
  readonly text: string;
  readonly busy: boolean;
}

export interface Edit {
  readonly text: string;
  readonly model: DesktopModelOption;
}

interface WindowProps {
  readonly stage: Staged;
  readonly mark: Mark;
  readonly waited: number;
  readonly composer: Composer;
  readonly model: DesktopModelOption;
  readonly edit?: Edit;
  readonly dock?: QuestionDock;
}

const subagents = { children: SUBAGENTS, open: noop };

/** The desktop app's window, drawn from its real parts. */
export function Window({ stage, mark, waited, composer, model, edit, dock }: WindowProps) {
  const picker = (current: DesktopModelOption) => (
    <ModelPicker catalog={modelCatalog} current={current} thinkingLevel="high" fast={false} onChange={noop} />
  );

  return (
    <div
      style={{
        width: size.width,
        height: size.height,
        borderRadius: 14,
        overflow: "hidden",
        background: "#1c1c1e",
        boxShadow: "0 0 0 1px rgb(255 255 255 / 0.1), 0 40px 120px -20px rgb(0 0 0 / 0.75), 0 0 80px rgb(120 130 255 / 0.08)",
        display: "flex",
        flexDirection: "column",
        color: "rgb(255 255 255 / 0.92)",
      }}
    >
      <Titlebar title="Migrate stored runs" />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Sidebar mark={mark} waited={waited} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
          <div style={{ flex: 1, overflow: "hidden", display: "flex", justifyContent: "center" }}>
            <div data-film="transcript" style={{ width: 720, paddingTop: 36 }}>
              <SubagentSessionsProvider value={subagents}>
                {stage.rows.map((row, index) =>
                  edit && index === 0 && row.kind === "part" && row.message.kind === "user" ? (
                    <div key={row.messageId} data-film="edit" style={{ paddingBottom: 12 }}>
                      <ComposerFrame
                        surface="follow-up"
                        document={{ text: edit.text, selectionStart: edit.text.length, selectionEnd: edit.text.length }}
                        onDocumentChange={noop}
                        onSubmit={submitNothing}
                        placeholder="Edit message"
                        editing={{ kind: "message", onCancel: noop }}
                        suggestionCatalog={noSuggestions}
                        mentionFiles={noFiles}
                        model={picker(edit.model)}
                      />
                    </div>
                  ) : (
                    <div key={row.messageId} data-film={row.kind === "part" && row.message.kind === "user" ? "prompt" : row.kind}>
                      <Row row={row} stage={stage} />
                    </div>
                  ),
                )}
              </SubagentSessionsProvider>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", paddingBottom: 22 }}>
            <div {...props(composerStyles.region)} style={{ width: 760 }} data-film="composer">
              {dock ? (
                <div data-film="tray" style={{ marginBottom: 10 }}>
                  <QuestionDockContext value={dock}>
                    <QuestionTray disabled={false} viewport={null} />
                  </QuestionDockContext>
                </div>
              ) : null}
              <ComposerFrame
                surface="follow-up"
                document={{ text: composer.text, selectionStart: composer.text.length, selectionEnd: composer.text.length }}
                onDocumentChange={noop}
                onSubmit={submitNothing}
                placeholder="Add a follow-up"
                busy={composer.busy}
                onAbort={noop}
                suggestionCatalog={noSuggestions}
                mentionFiles={noFiles}
                model={picker(model)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
