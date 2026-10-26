import { create, props } from "@stylexjs/stylex";
import {
  useEffectEvent,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { sidebarStyles as rail } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { shell, sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { Switch } from "@nyte-ai/ui/switch";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { DISPLAY_MODES, useDisplayMode, type DisplayMode } from "../shell/display-mode";
import { CHATS, DRAFTS, INBOX, PAGES, SPACE, type ShellTab } from "./fixtures";
import {
  NEEDS,
  NeedsYouPage,
  chatWithNeeds,
  type Need,
  type NeedAction,
  type NeedsDesign,
} from "./needs-you";
import { WindowTabStrip, useCardCorners, type StripDesign } from "./strip";

/** Decided; the lab draws these and the copied config records them. */
const SETTLED = {
  click: "own tab",
  closeGoes: "recent",
  numbering: "pinned",
  pinned: ["inbox"],
  pages: "open as tabs",
  inactive: "ghost",
  close: "hover",
  status: "glyph",
  active: "connected",
  width: "shrink",
  backForward: false,
  duplicate: false,
} as const;

const CONFIG_DEFAULT: StripDesign = { inverse: "card" };

const NEEDS_DEFAULT: NeedsDesign = { order: "urgency", finished: true };

/** How long a chat runs after you act before it lands back in Needs you as finished. */
const RUN_MS = 4000;

const RUNNING = new Set(CHATS.filter((chat) => chat.mark === "working").map((chat) => chat.id));

type OpenMode = "foreground" | "background";

interface TabState {
  readonly open: readonly ShellTab[];
  readonly active: string;
  readonly history: readonly string[];
  readonly closed: readonly { readonly tab: ShellTab; readonly index: number }[];
  readonly drafts: number;
  readonly needs: readonly Need[];
}

const STARTING_CHATS = new Set(["shadows", "trust"]);

const INITIAL: TabState = {
  open: [INBOX, ...CHATS.filter((tab) => STARTING_CHATS.has(tab.id))],
  active: "inbox",
  history: ["inbox", "trust", "shadows"],
  closed: [],
  drafts: 0,
  needs: NEEDS,
};

/** Showing a chat reads it, so a finished chat leaves Needs you once you look at it. */
function activate(state: TabState, id: string): TabState {
  if (!state.open.some((tab) => tab.id === id)) return state;

  return {
    ...state,
    active: id,
    history: [id, ...state.history.filter((entry) => entry !== id)].slice(0, 20),
    needs: state.needs.filter((need) => need.kind !== "finished" || need.chatId !== id),
  };
}

/** A place that already has a tab switches to it; otherwise it opens after the active tab. */
function openTab(state: TabState, tab: ShellTab, mode: OpenMode): TabState {
  if (state.open.some((entry) => entry.id === tab.id))
    return mode === "background" ? state : activate(state, tab.id);

  const at = state.open.findIndex((entry) => entry.id === state.active) + 1;
  const opened = { ...state, open: state.open.toSpliced(at, 0, tab) };

  return mode === "background" ? opened : activate(opened, tab.id);
}

/** Pinned tabs never close; closing the active tab goes back to the one used before it. */
function closeTab(state: TabState, id: string): TabState {
  const index = state.open.findIndex((tab) => tab.id === id);
  const tab = state.open[index];

  if (tab === undefined || tab.kind === "pinned") return state;
  const open = state.open.filter((entry) => entry.id !== id);
  const history = state.history.filter((entry) => entry !== id);
  const closed = [{ tab, index }, ...state.closed].slice(0, 25);

  if (state.active !== id) return { ...state, open, history, closed };

  const next =
    history.find((entry) => open.some((candidate) => candidate.id === entry)) ??
    (open[index] ?? open[index - 1])?.id ??
    id;

  return activate({ ...state, open, history, closed }, next);
}

function newTab(state: TabState): TabState {
  const title = DRAFTS[state.drafts % DRAFTS.length] ?? "New chat";
  const id = `draft-${String(state.drafts)}`;

  const tab: ShellTab = {
    id,
    kind: "chat",
    title,
    icon: "new-chat",
    mark: "idle",
    unread: false,
  };

  return activate({ ...state, open: [...state.open, tab], drafts: state.drafts + 1 }, id);
}

function reopenTab(state: TabState): TabState {
  const [last, ...closed] = state.closed;

  if (last === undefined) return state;

  return activate(
    {
      ...state,
      open: state.open.toSpliced(Math.min(last.index, state.open.length), 0, last.tab),
      closed,
    },
    last.tab.id,
  );
}

function cycleTab(state: TabState, step: 1 | -1): TabState {
  const index = state.open.findIndex((tab) => tab.id === state.active);
  const next = state.open[(index + step + state.open.length) % state.open.length];

  return next === undefined ? state : activate(state, next.id);
}

function clickMode(event: MouseEvent): OpenMode {
  return event.button === 1 || ((event.metaKey || event.ctrlKey) && !event.shiftKey)
    ? "background"
    : "foreground";
}

function configText(design: StripDesign, needs: NeedsDesign): string {
  return `Tabs lab config\n${JSON.stringify({ ...design, needs, settled: SETTLED }, null, 2)}`;
}

/** The pinned tab shows the most urgent thing waiting: blocked, then failed, then unread. */
function inboxMark(needs: readonly Need[], design: NeedsDesign): Pick<ShellTab, "mark" | "unread"> {
  if (needs.some((need) => need.kind === "approval" || need.kind === "question"))
    return { mark: "waiting", unread: false };

  if (needs.some((need) => need.kind === "failed")) return { mark: "failed", unread: false };

  return {
    mark: "idle",
    unread: design.finished && needs.some((need) => need.kind === "finished"),
  };
}

function finishedAfter(need: Need, action: NeedAction): Need {
  const summary =
    action.kind === "deny"
      ? "Stopped after you denied the request and wrote up what it skipped."
      : action.kind === "answer"
        ? `Went with “${action.option}” and finished.`
        : action.kind === "retry"
          ? "Retried and finished."
          : "Ran it and finished.";

  return {
    id: `${need.id}-done`,
    chatId: need.chatId,
    since: 0,
    kind: "finished",
    summary,
    changes: undefined,
  };
}

function TrafficLights(): ReactElement {
  return (
    <span aria-hidden="true" {...props(styles.lights)}>
      <span {...props(styles.lamp)} />
      <span {...props(styles.lamp)} />
      <span {...props(styles.lamp)} />
    </span>
  );
}

function OpenRow({
  tab,
  selected,
  onOpen,
}: {
  readonly tab: ShellTab;
  readonly selected: boolean;
  readonly onOpen: (tab: ShellTab, mode: OpenMode) => void;
}): ReactElement {
  return (
    <Row
      interactive
      selected={selected}
      xstyle={[rail.rowSurface, rail.sessionRow, selected && rail.rowSelected]}
    >
      {selected && <Row.Backdrop xstyle={rail.sessionSelection} />}
      <Row.Primary
        onClick={(event) => onOpen(tab, clickMode(event))}
        onAuxClick={(event) => {
          if (event.button === 1) onOpen(tab, "background");
        }}
      >
        <Row.Leading xstyle={rail.rowIcon}>
          {tab.kind === "chat" ? (
            <StatusDot mark={tab.mark} unread={tab.unread} />
          ) : (
            <Icon name={tab.icon} size={14} />
          )}
        </Row.Leading>
        <Row.Label xstyle={rail.sessionLabel}>{tab.title}</Row.Label>
      </Row.Primary>
    </Row>
  );
}

function Sidebar({
  chats,
  activeId,
  onOpen,
  onNew,
}: {
  readonly chats: readonly ShellTab[];
  readonly activeId: string;
  readonly onOpen: (tab: ShellTab, mode: OpenMode) => void;
  readonly onNew: () => void;
}): ReactElement {
  return (
    <nav aria-label="Sidebar" {...props(styles.sidebar)}>
      <div {...props(rail.primaryActions)}>
        <Row variant="nav" xstyle={rail.navRow} onClick={onNew}>
          <Row.Leading xstyle={rail.navLeading}>
            <Icon name="new-chat" size={14} />
          </Row.Leading>
          <Row.Label>New Chat</Row.Label>
        </Row>
        <Row variant="nav" xstyle={rail.navRow}>
          <Row.Leading xstyle={rail.navLeading}>
            <Icon name="search" size={14} />
          </Row.Leading>
          <Row.Label>Search</Row.Label>
        </Row>
        {PAGES.map((page) => (
          <OpenRow key={page.id} tab={page} selected={page.id === activeId} onOpen={onOpen} />
        ))}
      </div>
      <div {...props(rail.scroll)}>
        <section aria-label="Chats" {...props(rail.section)}>
          <div {...props(rail.sectionHeader)}>
            <span {...props(rail.sectionToggle)}>
              <span {...props(rail.sectionLabel)}>Chats</span>
            </span>
          </div>
          {chats.map((chat) => (
            <OpenRow key={chat.id} tab={chat} selected={chat.id === activeId} onOpen={onOpen} />
          ))}
        </section>
      </div>
    </nav>
  );
}

function CardContent({ tab }: { readonly tab: ShellTab | undefined }): ReactElement {
  if (tab === undefined) return <p {...props(styles.quiet)}>No tab open.</p>;

  return (
    <>
      <header {...props(styles.cardHeader)}>
        <span {...props(styles.crumb)}>{tab.kind === "chat" ? SPACE : "Window"}</span>
        <span {...props(styles.crumbDivider)}>/</span>
        <span {...props(styles.cardTitle)}>{tab.title}</span>
      </header>
      <div {...props(styles.cardBody)}>
        {tab.kind === "chat" ? (
          <>
            <div {...props(styles.you)}>{tab.title}</div>
            <p {...props(styles.reply)}>
              {tab.mark === "working"
                ? "Still working. The strip shows this from the other tabs too."
                : tab.mark === "waiting"
                  ? "One question before continuing: should the confirm copy stay as written?"
                  : tab.mark === "failed"
                    ? "The run failed on a network error. Retry from here."
                    : "Done. Switch tabs to see how the strip reports the others."}
            </p>
          </>
        ) : (
          <p {...props(styles.reply)}>A full-tab page.</p>
        )}
      </div>
    </>
  );
}

function Choice<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly onChange: (value: Value) => void;
}): ReactElement {
  return (
    <label {...props(styles.choice)}>
      <span {...props(styles.choiceLabel)}>{label}</span>
      <ToggleGroup
        aria-label={label}
        value={[value]}
        onValueChange={(values) => {
          const next = options.find((option) => option.value === values.at(-1));

          if (next !== undefined) onChange(next.value);
        }}
      >
        {options.map((option) => (
          <Toggle key={option.value} value={option.value} size="sm">
            {option.label}
          </Toggle>
        ))}
      </ToggleGroup>
    </label>
  );
}

function Flag({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <label {...props(styles.choice)}>
      <span {...props(styles.choiceLabel)}>{label}</span>
      <Switch label={label} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function CopyConfig({
  design,
  needs,
}: {
  readonly design: StripDesign;
  readonly needs: NeedsDesign;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);

  useMountEffect(() => () => clearTimeout(reset.current));

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(configText(design, needs));
    setCopied(true);
    clearTimeout(reset.current);
    reset.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      size="sm"
      variant="outline"
      icon={copied ? "checkmark" : "copy"}
      onClick={() => void copy()}
    >
      {copied ? "Copied" : "Copy config"}
    </Button>
  );
}

function Note({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <li {...props(styles.note)}>
      <span {...props(styles.noteTitle)}>{title}</span>
      <span>{children}</span>
    </li>
  );
}

export function TabsPage(): ReactElement {
  const [state, setState] = useState(INITIAL);
  const [design, setDesign] = useState(CONFIG_DEFAULT);
  const [needsDesign, setNeedsDesign] = useState(NEEDS_DEFAULT);
  const [running, setRunning] = useState<ReadonlySet<string>>(RUNNING);
  const runs = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [scheme, setScheme] = useState<DisplayMode>("dark");
  const [showSidebar, setShowSidebar] = useState(true);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const needs = state.needs;
  const chats = CHATS.map((chat) => chatWithNeeds(chat, needs, running));
  const inbox = inboxMark(needs, needsDesign);

  const tabs = state.open.map((tab) => {
    if (tab.id === INBOX.id) return { ...tab, ...inbox };

    return tab.kind === "chat"
      ? (chats.find((chat) => chat.id === tab.id) ?? chatWithNeeds(tab, needs, running))
      : tab;
  });

  const active = tabs.find((tab) => tab.id === state.active);
  const corners = useCardCorners(stripRef, cardRef, state.active);

  const act = (need: Need, action: NeedAction): void => {
    setState((current) => ({
      ...current,
      needs: current.needs.filter((entry) => entry.id !== need.id),
    }));

    if (action.kind === "read") return;
    setRunning((current) => new Set([...current, need.chatId]));

    const timer = setTimeout(() => {
      runs.current.delete(timer);
      setRunning((current) => new Set([...current].filter((id) => id !== need.chatId)));
      setState((current) =>
        current.active === need.chatId
          ? current
          : { ...current, needs: [...current.needs, finishedAfter(need, action)] },
      );
    }, RUN_MS);

    runs.current.add(timer);
  };

  const openChat = (chatId: string, event: MouseEvent | undefined): void => {
    const chat = CHATS.find((entry) => entry.id === chatId);

    if (chat === undefined) return;
    setState((current) =>
      openTab(current, chat, event === undefined ? "foreground" : clickMode(event)),
    );
  };

  const reset = (): void => {
    for (const timer of runs.current) clearTimeout(timer);
    runs.current.clear();
    setState((current) => ({ ...current, needs: NEEDS }));
    setRunning(RUNNING);
  };

  useDisplayMode(scheme);

  useMountEffect(() => {
    const pending = runs.current;

    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  });

  const onKey = useEffectEvent((event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();

    if (event.altKey && key === "w") {
      event.preventDefault();
      setState((current) => closeTab(current, current.active));
    } else if (event.altKey && event.shiftKey && key === "t") {
      event.preventDefault();
      setState(reopenTab);
    } else if (event.altKey && key === "t") {
      event.preventDefault();
      setState(newTab);
    } else if (event.altKey && /^[1-9]$/.test(event.key)) {
      const target = state.open[Number(event.key) - 1];

      if (target === undefined) return;
      event.preventDefault();
      setState((current) => activate(current, target.id));
    } else if (event.ctrlKey && event.key === "Tab") {
      event.preventDefault();
      setState((current) => cycleTab(current, event.shiftKey ? -1 : 1));
    }
  });

  useMountEffect(() => {
    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <main {...props(styles.page)}>
      <div {...props(styles.column)}>
        <header {...props(styles.header)}>
          <h1 {...props(styles.title)}>Window tabs</h1>
          <p {...props(styles.lede)}>
            A tab is a chat or a page. Click one in the sidebar to open it in its own tab, or
            ⌘-click to open it behind. <Kbd keys={["⌥", "1"]} plain />–
            <Kbd keys={["⌥", "9"]} plain /> jump, <Kbd keys={["⌥", "W"]} plain /> closes,{" "}
            <Kbd keys={["⌥", "T"]} plain /> opens, <Kbd keys={["⌥", "⇧", "T"]} plain /> reopens,{" "}
            <Kbd keys={["⌃", "Tab"]} plain /> cycles.
          </p>
        </header>

        <div role="toolbar" aria-label="Design" {...props(styles.toolbar)}>
          <Choice
            label="Inverse curve"
            value={design.inverse}
            options={[
              { value: "card", label: "Card radius" },
              { value: "control", label: "Control radius" },
            ]}
            onChange={(inverse) => setDesign({ inverse })}
          />
          <span {...props(styles.toolbarRule)} />
          <Choice label="Scheme" value={scheme} options={DISPLAY_MODES} onChange={setScheme} />
          <Flag label="Sidebar" checked={showSidebar} onChange={setShowSidebar} />
          <CopyConfig design={design} needs={needsDesign} />
        </div>

        <div role="toolbar" aria-label="Needs you" {...props(styles.toolbar)}>
          <Choice
            label="Needs you order"
            value={needsDesign.order}
            options={[
              { value: "urgency", label: "By urgency" },
              { value: "newest", label: "Newest first" },
            ]}
            onChange={(order) => setNeedsDesign({ ...needsDesign, order })}
          />
          <Flag
            label="Finished chats"
            checked={needsDesign.finished}
            onChange={(finished) => setNeedsDesign({ ...needsDesign, finished })}
          />
          <Button size="sm" variant="outline" icon="refresh" onClick={reset}>
            Reset
          </Button>
        </div>

        <div {...props(styles.window)}>
          <div {...props(styles.titlebar)}>
            <div {...props(styles.sidebarSlot, showSidebar && styles.sidebarSlotOpen)}>
              <TrafficLights />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="panel-left"
                aria-label={showSidebar ? "Hide sidebar" : "Show sidebar"}
                onClick={() => setShowSidebar(!showSidebar)}
              />
              {!showSidebar && (
                <Menu>
                  <MenuTrigger
                    render={
                      <Button size="sm" variant="ghost">
                        {SPACE}
                        <Icon name="chevron-down" size={12} />
                      </Button>
                    }
                  />
                  <MenuContent aria-label="Spaces" align="start">
                    <MenuItem icon="folder">{SPACE}</MenuItem>
                    <MenuItem icon="folder">site</MenuItem>
                    <MenuItem icon="cloud">Cloud</MenuItem>
                    <MenuSeparator />
                    <MenuItem icon="folder-add">Open Folder…</MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </div>
            <div {...props(styles.center)}>
              <WindowTabStrip
                tabs={tabs}
                activeId={state.active}
                numbered={state.open.map((tab) => tab.id)}
                flush={corners}
                design={design}
                stripRef={stripRef}
                onActivate={(id) => setState((current) => activate(current, id))}
                onClose={(id) => setState((current) => closeTab(current, id))}
                onNew={() => setState(newTab)}
              />
            </div>
            <div {...props(styles.trailing)}>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon="chevron-down"
                      aria-label="All tabs"
                    />
                  }
                />
                <MenuContent aria-label="All tabs" align="end">
                  {tabs.map((tab) => (
                    <MenuItem
                      key={tab.id}
                      icon={tab.icon}
                      leading={
                        tab.mark !== "idle" || tab.unread ? (
                          <StatusDot mark={tab.mark} unread={tab.unread} />
                        ) : undefined
                      }
                      meta={tab.id === state.active ? "Current" : undefined}
                      onClick={() => setState((current) => activate(current, tab.id))}
                    >
                      {tab.title}
                    </MenuItem>
                  ))}
                  {state.closed.length > 0 && (
                    <>
                      <MenuSeparator />
                      <MenuItem icon="refresh" meta="⌥⇧T" onClick={() => setState(reopenTab)}>
                        Reopen {state.closed[0]?.tab.title}
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="panel-right"
                aria-label="Show workbench"
              />
            </div>
          </div>
          <div {...props(styles.body, showSidebar && styles.bodyWithSidebar)}>
            {showSidebar && (
              <Sidebar
                chats={chats}
                activeId={state.active}
                onOpen={(tab, mode) => setState((current) => openTab(current, tab, mode))}
                onNew={() => setState(newTab)}
              />
            )}
            <div
              ref={cardRef}
              {...props(
                styles.card,
                corners.left && styles.cardSquareLeft,
                corners.right && styles.cardSquareRight,
              )}
            >
              {active?.id === INBOX.id ? (
                <NeedsYouPage
                  needs={needs}
                  chats={chats}
                  design={needsDesign}
                  onAct={act}
                  onOpen={openChat}
                />
              ) : (
                <CardContent tab={active} />
              )}
            </div>
          </div>
        </div>

        <section {...props(styles.notes)}>
          <h2 {...props(styles.notesTitle)}>Needs you</h2>
          <ul {...props(styles.list)}>
            <Note title="What lands here">
              Approvals and questions, where the agent is stopped until you answer; failed runs; and
              finished chats you haven&apos;t read. Working chats stay out: the strip already shows
              them. Requests from subagents say who asked.
            </Note>
            <Note title="Order">
              By urgency puts blocked chats first, longest waiting at the top, because every minute
              blocked is an idle agent. Failed runs follow, then finished chats, newest first.
              Newest first is one list by time, like t3code&apos;s inbox.
            </Note>
            <Note title="Act in place">
              Allow, deny, answer and retry without leaving the page. The chat runs again and comes
              back as finished, so you can clear a queue while several agents work. Opening a chat
              gives it its own tab and marks a finished chat read.
            </Note>
            <Note title="Keyboard">
              J and K move, Enter opens. A allows once, S allows for the session, D denies, 1–9
              answers, R retries, E marks read. Acting moves the selection to the next item.
            </Note>
            <Note title="The pinned tab">
              Its icon becomes the most urgent status: waiting while anything is blocked, failed
              while a run failed, unread while only finished chats remain.
            </Note>
          </ul>
          <h2 {...props(styles.notesTitle)}>Drawing the active tab</h2>
          <ul {...props(styles.list)}>
            <Note title="Circles">
              The active tab and its two inverse curves are one path. Its top corners are quarter
              circles of the card&apos;s radius. Each inverse curve is a quarter circle tangent to
              the tab&apos;s side and to the card&apos;s top edge, so it lands exactly on the
              card&apos;s hairline, which the outline continues.
            </Note>
            <Note title="Flush with the card">
              When the active tab lines up with the card&apos;s edge, that side has no inverse
              curve: the card&apos;s corner squares off and the tab&apos;s top corner, also the
              card&apos;s radius, becomes the sheet&apos;s corner.
            </Note>
            <Note title="Inverse curve">
              Card radius uses one 6px circle everywhere, Arc&apos;s page corner. Control radius
              draws the inverse curves at 8px, wider than the corners; Chrome&apos;s are tighter.
            </Note>
            <Note title="No layout shift">
              Active and inactive tabs share one content box and one width. The active tab trades
              the inactive tabs&apos; bottom margin for the same padding, so clicking a tab only
              repaints it.
            </Note>
            <Note title="Pages">
              Customize and Environments open from the sidebar as ordinary tabs and close like any
              other. Needs you is the only pinned tab.
            </Note>
          </ul>
        </section>
      </div>
    </main>
  );
}

const styles = create({
  page: {
    height: "100%",
    overflowY: "auto",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 1440,
    marginInline: "auto",
    padding: "48px 32px 96px",
  },
  header: { display: "flex", flexDirection: "column", gap: 4, maxWidth: 760 },
  title: { margin: 0, fontSize: type.font2xl, fontWeight: 600, letterSpacing: type.letterLg },
  lede: { margin: 0, color: role.contentSecondary, fontSize: type.fontBase },
  toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, rowGap: 10 },
  toolbarRule: { width: 1, alignSelf: "stretch", backgroundColor: role.borderSecondaryTranslucent },
  choice: { display: "inline-flex", alignItems: "center", gap: 8 },
  choiceLabel: { color: role.contentTertiary, fontSize: type.fontSm, whiteSpace: "nowrap" },
  window: {
    display: "flex",
    flexDirection: "column",
    height: 640,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: role.bgChrome,
    color: role.contentPrimary,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  titlebar: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    height: shell.titlebarHeight,
    backgroundColor: role.sidebarMaterial,
  },
  sidebarSlot: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    height: "100%",
    paddingInlineStart: 72,
    paddingInlineEnd: 4,
  },
  sidebarSlotOpen: { width: sidebar.width, paddingInlineEnd: 8 },
  lights: {
    position: "absolute",
    insetInlineStart: 12,
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    gap: 8,
  },
  lamp: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: role.bgHover,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  center: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    height: "100%",
    paddingInlineStart: shell.cardInset,
  },
  trailing: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
    paddingInline: 8,
  },
  body: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    flex: 1,
    minHeight: 0,
    paddingInlineEnd: shell.cardInset,
    paddingBottom: shell.cardInset,
    backgroundColor: role.sidebarMaterial,
  },
  bodyWithSidebar: { gridTemplateColumns: `${sidebar.width} minmax(0, 1fr)` },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    paddingInlineStart: shell.cardInset,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    marginInlineStart: shell.cardInset,
    borderRadius: shell.cardRadius,
    backgroundColor: role.bgBase,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  cardSquareLeft: { borderStartStartRadius: 0 },
  cardSquareRight: { borderStartEndRadius: 0 },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingBlock: 10,
    paddingInline: 16,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  crumb: { color: role.contentSecondary },
  crumbDivider: { color: role.contentDisabled },
  cardTitle: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    color: role.contentSecondary,
  },
  cardBody: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "100%",
    maxWidth: 640,
    marginInline: "auto",
    padding: 24,
  },
  you: {
    alignSelf: "flex-end",
    maxWidth: "80%",
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  reply: { margin: 0, fontSize: type.fontBase, lineHeight: type.leadingBase },
  quiet: { margin: 0, padding: 24, color: role.contentTertiary, fontSize: type.fontSm },
  notes: { display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 },
  notesTitle: { margin: 0, marginTop: 8, fontSize: type.fontBase, fontWeight: 600 },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    margin: 0,
    padding: 0,
    listStyle: "none",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  note: { display: "flex", flexDirection: "column", gap: 2 },
  noteTitle: { color: role.contentPrimary, fontWeight: 600 },
});
