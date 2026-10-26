import { create, props } from "@stylexjs/stylex";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { glyph, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { SPACE, type ShellTab } from "./fixtures";

/** Something a chat is waiting on you for. `since` is minutes ago. */
export type Need =
  | {
      readonly id: string;
      readonly chatId: string;
      readonly since: number;
      readonly kind: "approval";
      readonly title: string;
      readonly detail: string;
      readonly origin: string | undefined;
    }
  | {
      readonly id: string;
      readonly chatId: string;
      readonly since: number;
      readonly kind: "question";
      readonly question: string;
      readonly options: readonly string[];
    }
  | {
      readonly id: string;
      readonly chatId: string;
      readonly since: number;
      readonly kind: "failed";
      readonly error: string;
    }
  | {
      readonly id: string;
      readonly chatId: string;
      readonly since: number;
      readonly kind: "finished";
      readonly summary: string;
      readonly changes:
        | { readonly added: number; readonly removed: number; readonly files: number }
        | undefined;
    };

export type NeedAction =
  | { readonly kind: "allow"; readonly scope: "once" | "session" }
  | { readonly kind: "deny" }
  | { readonly kind: "answer"; readonly option: string }
  | { readonly kind: "retry" }
  | { readonly kind: "read" };

export interface NeedsDesign {
  /** urgency: blocked, then failed, then finished. newest: one list by time. */
  readonly order: "urgency" | "newest";
  readonly finished: boolean;
}

export const NEEDS: readonly Need[] = [
  {
    id: "need-dialogs",
    chatId: "dialogs",
    since: 2,
    kind: "approval",
    title: "Run this command?",
    detail: "pnpm --dir packages/app test -- dialog",
    origin: "Dialog audit",
  },
  {
    id: "need-trust",
    chatId: "trust",
    since: 6,
    kind: "question",
    question: "Should the confirm copy stay as written?",
    options: ["Keep it", "Shorten it"],
  },
  {
    id: "need-config",
    chatId: "config",
    since: 9,
    kind: "approval",
    title: "Edit outside the workspace?",
    detail: "~/.config/nyte/settings.json",
    origin: undefined,
  },
  {
    id: "need-titlebar",
    chatId: "titlebar",
    since: 14,
    kind: "failed",
    error: "The connection to the model reset (ECONNRESET).",
  },
  {
    id: "need-tokens",
    chatId: "tokens",
    since: 25,
    kind: "finished",
    summary:
      "Mapped 14 translucent tints to role tokens. Two need a new token; both are in the plan.",
    changes: { added: 42, removed: 18, files: 6 },
  },
  {
    id: "need-review",
    chatId: "review",
    since: 40,
    kind: "finished",
    summary: "Reviewed #412. The traffic lights sit 2px low on Windows; the rest matches.",
    changes: undefined,
  },
];

/** A chat's mark and unread dot follow what it is waiting on, then whether it is running. */
export function chatWithNeeds(
  chat: ShellTab,
  needs: readonly Need[],
  working: ReadonlySet<string>,
): ShellTab {
  const own = needs.filter((need) => need.chatId === chat.id);

  if (own.some((need) => need.kind === "approval" || need.kind === "question"))
    return { ...chat, mark: "waiting", unread: false };

  if (own.some((need) => need.kind === "failed")) return { ...chat, mark: "failed", unread: false };

  if (working.has(chat.id)) return { ...chat, mark: "working", unread: false };

  return { ...chat, mark: "idle", unread: own.some((need) => need.kind === "finished") };
}

const BLOCKED = new Set<Need["kind"]>(["approval", "question"]);

const SECTIONS = [
  { key: "blocked", label: "Blocked", kinds: BLOCKED },
  { key: "failed", label: "Failed", kinds: new Set<Need["kind"]>(["failed"]) },
  { key: "finished", label: "Finished", kinds: new Set<Need["kind"]>(["finished"]) },
] as const;

interface Section {
  readonly key: string;
  readonly label: string | undefined;
  readonly needs: readonly Need[];
}

/** Blocked and failed chats wait longest first; finished chats read newest first. */
function arrange(needs: readonly Need[], design: NeedsDesign): readonly Section[] {
  const shown = needs.filter((need) => design.finished || need.kind !== "finished");

  if (design.order === "newest")
    return [{ key: "all", label: undefined, needs: shown.toSorted((a, b) => a.since - b.since) }];

  return SECTIONS.flatMap((section) => {
    const members = shown
      .filter((need) => section.kinds.has(need.kind))
      .toSorted((a, b) => (section.key === "finished" ? a.since - b.since : b.since - a.since));

    return members.length === 0 ? [] : [{ key: section.key, label: section.label, needs: members }];
  });
}

function ago(minutes: number): string {
  if (minutes < 1) return "now";

  return minutes < 60 ? `${String(minutes)}m` : `${String(Math.floor(minutes / 60))}h`;
}

const KIND: Record<Need["kind"], { readonly icon: IconName; readonly label: string }> = {
  approval: { icon: "shield", label: "Approval" },
  question: { icon: "bubble-question", label: "Question" },
  failed: { icon: "warning", label: "Failed" },
  finished: { icon: "checkmark", label: "Finished" },
};

function kindTone(kind: Need["kind"]) {
  switch (kind) {
    case "approval":
    case "question":
      return intent.warning;
    case "failed":
      return intent.danger;
    case "finished":
      return intent.primary;
    default: {
      const _exhaustive: never = kind;

      return _exhaustive;
    }
  }
}

/** The keys that act on the selected need; Enter opens its chat. */
function keyAction(need: Need, key: string): NeedAction | undefined {
  switch (need.kind) {
    case "approval":
      return key === "a"
        ? { kind: "allow", scope: "once" }
        : key === "s"
          ? { kind: "allow", scope: "session" }
          : key === "d"
            ? { kind: "deny" }
            : undefined;
    case "question": {
      const option = /^[1-9]$/.test(key) ? need.options[Number(key) - 1] : undefined;

      return option === undefined ? undefined : { kind: "answer", option };
    }

    case "failed":
      return key === "r" ? { kind: "retry" } : undefined;
    case "finished":
      return key === "e" ? { kind: "read" } : undefined;
    default: {
      const _exhaustive: never = need;

      return _exhaustive;
    }
  }
}

function Actions({
  need,
  onAct,
  onOpen,
}: {
  readonly need: Need;
  readonly onAct: (action: NeedAction) => void;
  readonly onOpen: (event: MouseEvent) => void;
}): ReactElement {
  switch (need.kind) {
    case "approval":
      return (
        <div {...props(styles.actions)}>
          <Button size="sm" variant="solid" onClick={() => onAct({ kind: "allow", scope: "once" })}>
            Allow once
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAct({ kind: "allow", scope: "session" })}
          >
            Allow for this session
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAct({ kind: "deny" })}>
            Deny
          </Button>
        </div>
      );
    case "question":
      return (
        <div {...props(styles.actions)}>
          {need.options.map((option, index) => (
            <Button
              key={option}
              size="sm"
              variant={index === 0 ? "solid" : "outline"}
              onClick={() => onAct({ kind: "answer", option })}
            >
              {option}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={onOpen}>
            Answer in chat
          </Button>
        </div>
      );
    case "failed":
      return (
        <div {...props(styles.actions)}>
          <Button size="sm" variant="solid" icon="refresh" onClick={() => onAct({ kind: "retry" })}>
            Retry
          </Button>
          <Button size="sm" variant="outline" onClick={onOpen}>
            Open
          </Button>
        </div>
      );
    case "finished":
      return (
        <div {...props(styles.actions)}>
          <Button size="sm" variant="outline" onClick={onOpen}>
            Open
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAct({ kind: "read" })}>
            Mark read
          </Button>
        </div>
      );
    default: {
      const _exhaustive: never = need;

      return _exhaustive;
    }
  }
}

function Body({ need }: { readonly need: Need }): ReactElement {
  switch (need.kind) {
    case "approval":
      return (
        <>
          <p {...props(styles.prompt)}>{need.title}</p>
          <pre {...props(styles.detail)}>{need.detail}</pre>
        </>
      );
    case "question":
      return <p {...props(styles.prompt)}>{need.question}</p>;
    case "failed":
      return <p {...props(styles.text)}>{need.error}</p>;
    case "finished":
      return (
        <>
          <p {...props(styles.text)}>{need.summary}</p>
          {need.changes !== undefined && (
            <p {...props(styles.changes)}>
              <span {...props(intent.success, styles.stat)}>+{need.changes.added}</span>{" "}
              <span {...props(intent.danger, styles.stat)}>-{need.changes.removed}</span> in{" "}
              {need.changes.files} files
            </p>
          )}
        </>
      );
    default: {
      const _exhaustive: never = need;

      return _exhaustive;
    }
  }
}

function Item({
  need,
  chat,
  selected,
  onSelect,
  onAct,
  onOpen,
}: {
  readonly need: Need;
  readonly chat: ShellTab | undefined;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onAct: (action: NeedAction) => void;
  readonly onOpen: (event: MouseEvent) => void;
}): ReactElement {
  const kind = KIND[need.kind];

  return (
    <motion.article
      layout="position"
      initial={false}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.18 }}
      aria-label={`${kind.label}: ${chat?.title ?? need.chatId}`}
      aria-current={selected || undefined}
      onMouseDown={onSelect}
      {...props(styles.item, selected && styles.itemSelected)}
    >
      <span {...props(styles.kind, kindTone(need.kind))}>
        <Icon name={kind.icon} size={14} />
      </span>
      <div {...props(styles.main)}>
        <header {...props(styles.itemHeader)}>
          <button type="button" onClick={onOpen} {...props(styles.title, focus.ring)}>
            {chat?.title ?? need.chatId}
          </button>
          <span {...props(styles.meta)}>
            {SPACE}
            {need.kind === "approval" && need.origin !== undefined && ` · Asked by ${need.origin}`}
          </span>
          <span {...props(styles.time)}>{ago(need.since)}</span>
        </header>
        <Body need={need} />
        <Actions need={need} onAct={onAct} onOpen={onOpen} />
      </div>
    </motion.article>
  );
}

/** Keyboard triage for every chat waiting on you; the selection shows only while it has focus. */
export function NeedsYouPage({
  needs,
  chats,
  design,
  onAct,
  onOpen,
}: {
  readonly needs: readonly Need[];
  readonly chats: readonly ShellTab[];
  readonly design: NeedsDesign;
  readonly onAct: (need: Need, action: NeedAction) => void;
  readonly onOpen: (chatId: string, event: MouseEvent | undefined) => void;
}): ReactElement {
  const sections = arrange(needs, design);
  const ordered = sections.flatMap((section) => section.needs);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [focused, setFocused] = useState(false);
  const selected = ordered.find((need) => need.id === selectedId) ?? ordered[0];
  const blocked = needs.filter((need) => BLOCKED.has(need.kind)).length;
  const headingId = useId();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.metaKey || event.ctrlKey || selected === undefined) return;
    const key = event.key.toLowerCase();
    const index = ordered.indexOf(selected);
    const step = key === "j" || key === "arrowdown" ? 1 : key === "k" || key === "arrowup" ? -1 : 0;

    if (step !== 0) {
      event.preventDefault();
      setSelectedId(ordered[Math.min(Math.max(index + step, 0), ordered.length - 1)]?.id);

      return;
    }

    if (key === "enter") {
      event.preventDefault();
      onOpen(selected.chatId, undefined);

      return;
    }

    const action = keyAction(selected, key);

    if (action === undefined) return;
    event.preventDefault();
    setSelectedId(ordered[index + 1]?.id ?? ordered[index - 1]?.id);
    onAct(selected, action);
  };

  return (
    <div
      role="region"
      tabIndex={0}
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      {...props(styles.page, focus.ringInset)}
    >
      <header {...props(styles.header)}>
        <h2 id={headingId} {...props(styles.heading)}>
          Needs you
        </h2>
        {needs.length > 0 && (
          <span {...props(styles.summary)}>
            {blocked > 0 ? `${String(blocked)} blocked` : `${String(needs.length)} to read`}
          </span>
        )}
      </header>

      {ordered.length === 0 ? (
        <div {...props(styles.empty)}>
          <Icon name="inbox-checked" size={20} />
          <p {...props(styles.emptyTitle)}>Nothing needs you</p>
          <p {...props(styles.emptyText)}>
            Approvals, questions, failed runs and finished chats land here.
          </p>
        </div>
      ) : (
        sections.map((section) => (
          <section
            key={section.key}
            aria-label={section.label ?? "Needs"}
            {...props(styles.section)}
          >
            {section.label !== undefined && (
              <h3 {...props(styles.sectionLabel)}>
                {section.label}
                <span {...props(styles.count)}>{section.needs.length}</span>
              </h3>
            )}
            <AnimatePresence initial={false}>
              {section.needs.map((need) => (
                <Item
                  key={need.id}
                  need={need}
                  chat={chats.find((chat) => chat.id === need.chatId)}
                  selected={focused && need === selected}
                  onSelect={() => setSelectedId(need.id)}
                  onAct={(action) => onAct(need, action)}
                  onOpen={(event) => onOpen(need.chatId, event)}
                />
              ))}
            </AnimatePresence>
          </section>
        ))
      )}

      {ordered.length > 0 && (
        <footer {...props(styles.keys)}>
          <span>
            <Kbd keys={["J"]} plain /> <Kbd keys={["K"]} plain /> move
          </span>
          <span>
            <Kbd keys={["↵"]} plain /> open
          </span>
          <span>
            <Kbd keys={["A"]} plain /> allow <Kbd keys={["S"]} plain /> for session{" "}
            <Kbd keys={["D"]} plain /> deny
          </span>
          <span>
            <Kbd keys={["1"]} plain /> answer
          </span>
          <span>
            <Kbd keys={["R"]} plain /> retry
          </span>
          <span>
            <Kbd keys={["E"]} plain /> mark read
          </span>
        </footer>
      )}
    </div>
  );
}

const styles = create({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    width: "100%",
    maxWidth: 720,
    marginInline: "auto",
    paddingBlock: 28,
    paddingInline: 24,
    outline: "none",
  },
  header: { display: "flex", alignItems: "baseline", gap: 10 },
  heading: { margin: 0, fontSize: type.fontLg, fontWeight: type.weightMedium },
  summary: { color: role.contentTertiary, fontSize: type.fontSm },
  section: { display: "flex", flexDirection: "column", gap: 6 },
  sectionLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    paddingInline: 10,
    color: role.contentTertiary,
    fontSize: type.fontXs,
    fontWeight: type.weightMedium,
  },
  count: { fontVariantNumeric: "tabular-nums" },
  item: {
    display: "flex",
    gap: 10,
    paddingBlock: 12,
    paddingInline: 10,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
  },
  itemSelected: {
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  kind: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: glyph.lg,
    height: glyph.lg,
    color: role.contentInteractivePrimary,
  },
  main: { display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 },
  itemHeader: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 },
  title: {
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.indicator,
    backgroundColor: "transparent",
    color: role.contentPrimary,
    fontFamily: "inherit",
    fontSize: type.fontBase,
    fontWeight: type.weightMedium,
    textAlign: "start",
    textDecoration: { default: "none", ":hover": "underline" },
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    cursor: "pointer",
  },
  meta: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    color: role.contentTertiary,
    fontSize: type.fontSm,
  },
  time: {
    flexShrink: 0,
    color: role.contentTertiary,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
  },
  prompt: { margin: 0, color: role.contentPrimary, fontSize: type.fontBase },
  text: { margin: 0, color: role.contentSecondary, fontSize: type.fontBase },
  detail: {
    margin: 0,
    maxHeight: 120,
    overflow: "auto",
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontSm,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  changes: {
    margin: 0,
    color: role.contentTertiary,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
  },
  stat: { color: role.contentSecondary },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    marginBlock: "auto",
    paddingBlock: 48,
    color: role.contentTertiary,
    textAlign: "center",
  },
  emptyTitle: { margin: 0, color: role.contentPrimary, fontSize: type.fontBase },
  emptyText: { margin: 0, fontSize: type.fontSm },
  keys: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    marginTop: "auto",
    paddingInline: 10,
    color: role.contentTertiary,
    fontSize: type.fontXs,
  },
});
