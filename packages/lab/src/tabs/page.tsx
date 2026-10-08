/**
 * Window tabs in the titlebar, after Dia and Arc. The whole window is drawn so
 * the strip can be judged against the traffic lights, the sidebar slot and the
 * card it sits on. Every design switch is above the window; the notes below it
 * say what each one is for and what the default should be.
 */
import { create, props } from "@stylexjs/stylex";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { sidebarStyles as rail } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { shell, sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { Switch } from "@nyte-ai/ui/switch";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { motion as motionTokens, role, type } from "@nyte-ai/ui/vars.stylex";
import { DRAFTS, SPACE, TABS, type ShellTab } from "./fixtures";
import { WindowTabStrip, useCardCorners, type StripDesign } from "./strip";

type CloseGoes = "recent" | "neighbour";

type Scheme = "light" | "dark";

interface ShellDesign extends StripDesign {
  readonly closeGoes: CloseGoes;
  readonly sidebar: boolean;
  readonly scheme: Scheme;
}

/** Dia's defaults, with the card active style from the shipped strip as the alternative. */
const DESIGN_DEFAULT: ShellDesign = {
  active: "connected",
  inactive: "chip",
  close: "beside",
  pinned: "icon",
  folders: true,
  dividers: true,
  width: "shrink",
  status: "badge",
  closeGoes: "recent",
  sidebar: false,
  scheme: "dark",
};

interface TabState {
  readonly open: readonly ShellTab[];
  readonly active: string;
  /** Most recent first. */
  readonly history: readonly string[];
  readonly closed: readonly { readonly tab: ShellTab; readonly index: number }[];
  readonly drafts: number;
}

const INITIAL: TabState = {
  open: TABS,
  active: "trust",
  history: ["trust", "shadows", "review"],
  closed: [],
  drafts: 0,
};

function activate(state: TabState, id: string): TabState {
  if (!state.open.some((tab) => tab.id === id)) return state;

  return {
    ...state,
    active: id,
    history: [id, ...state.history.filter((entry) => entry !== id)].slice(0, 20),
  };
}

function closeTab(state: TabState, id: string, goes: CloseGoes): TabState {
  const index = state.open.findIndex((tab) => tab.id === id);
  const tab = state.open[index];

  if (tab === undefined || tab.kind !== "chat") return state;
  const open = state.open.filter((entry) => entry.id !== id);
  const history = state.history.filter((entry) => entry !== id);
  const closed = [{ tab, index }, ...state.closed].slice(0, 25);

  if (state.active !== id) return { ...state, open, history, closed };

  const recent = history.find((entry) => open.some((tab) => tab.id === entry));
  const neighbour = (open[index] ?? open[index - 1])?.id;
  const next = (goes === "recent" ? recent : undefined) ?? neighbour ?? open[0]?.id ?? id;

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
  const open = [...state.open];

  open.splice(Math.min(last.index, open.length), 0, last.tab);

  return activate({ ...state, open, closed }, last.tab.id);
}

function cycleTab(state: TabState, shown: readonly ShellTab[], step: 1 | -1): TabState {
  const index = shown.findIndex((tab) => tab.id === state.active);
  const next = shown[(index + step + shown.length) % shown.length];

  return next === undefined ? state : activate(state, next.id);
}

function visible(tabs: readonly ShellTab[], design: ShellDesign): readonly ShellTab[] {
  return tabs.filter((tab) => {
    if (tab.kind === "pinned") return design.pinned !== "off";

    if (tab.kind === "folder") return design.folders;

    return true;
  });
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

function Sidebar({
  tabs,
  activeId,
  onOpen,
}: {
  readonly tabs: readonly ShellTab[];
  readonly activeId: string;
  readonly onOpen: (id: string) => void;
}): ReactElement {
  return (
    <nav aria-label="Sidebar" {...props(styles.sidebar)}>
      <div {...props(rail.primaryActions)}>
        <Row variant="nav" xstyle={rail.navRow}>
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
      </div>
      <div {...props(rail.scroll)}>
        <section aria-label="Chats" {...props(rail.section)}>
          <div {...props(rail.sectionHeader)}>
            <span {...props(rail.sectionToggle)}>
              <span {...props(rail.sectionLabel)}>Chats</span>
            </span>
          </div>
          {tabs
            .filter((tab) => tab.kind === "chat")
            .map((tab) => {
              const selected = tab.id === activeId;

              return (
                <Row
                  key={tab.id}
                  interactive
                  selected={selected}
                  xstyle={[rail.rowSurface, rail.sessionRow, selected && rail.rowSelected]}
                >
                  {selected && <Row.Backdrop xstyle={rail.sessionSelection} />}
                  <Row.Primary onClick={() => onOpen(tab.id)}>
                    <Row.Leading xstyle={rail.rowIcon}>
                      <StatusDot mark={tab.mark} unread={tab.unread} />
                    </Row.Leading>
                    <Row.Label xstyle={rail.sessionLabel}>{tab.title}</Row.Label>
                  </Row.Primary>
                </Row>
              );
            })}
        </section>
      </div>
    </nav>
  );
}

/** Enough of a page to tell which tab is showing. */
function CardContent({ tab }: { readonly tab: ShellTab | undefined }): ReactElement {
  if (tab === undefined) return <p {...props(styles.quiet)}>No tab open.</p>;

  return (
    <>
      <header {...props(styles.cardHeader)}>
        <span {...props(styles.crumb)}>{tab.kind === "pinned" ? "Window" : SPACE}</span>
        <span {...props(styles.crumbDivider)}>/</span>
        <span {...props(styles.cardTitle)}>{tab.title}</span>
      </header>
      <div {...props(styles.cardBody)}>
        {tab.kind === "chat" && (
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
        )}
        {tab.kind === "folder" && (
          <p {...props(styles.reply)}>
            A project. Its coordinator runs {String(tab.count ?? 0)} agents; each opens as a tab
            inside this one, as in the Projects board.
          </p>
        )}
        {tab.kind === "pinned" && (
          <p {...props(styles.reply)}>
            A full-tab page. It fills the card and stays pinned, so it is always one click away.
          </p>
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
  const [design, setDesign] = useState(DESIGN_DEFAULT);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const connected = design.active === "connected";
  const shown = visible(state.open, design);
  const active = state.open.find((tab) => tab.id === state.active);
  const corners = useCardCorners(stripRef, cardRef, state.active, connected);

  const set = <Key extends keyof ShellDesign>(key: Key, value: ShellDesign[Key]): void =>
    setDesign((current) => ({ ...current, [key]: value }));

  // On the document, so menus and tooltips, which portal out of the window, follow it.
  useEffect(() => {
    document.documentElement.style.colorScheme = design.scheme;

    return () => {
      document.documentElement.style.colorScheme = "";
    };
  }, [design.scheme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();

      // ⌥ stands in for ⌘ here: the browser keeps ⌘W and ⌘T for itself.
      if (event.altKey && key === "w") {
        event.preventDefault();
        setState((current) => closeTab(current, current.active, design.closeGoes));
      } else if (event.altKey && event.shiftKey && key === "t") {
        event.preventDefault();
        setState(reopenTab);
      } else if (event.altKey && key === "t") {
        event.preventDefault();
        setState(newTab);
      } else if (event.altKey && /^[1-9]$/.test(event.key)) {
        const target = shown[Number(event.key) - 1];

        if (target === undefined) return;
        event.preventDefault();
        setState((current) => activate(current, target.id));
      } else if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();
        setState((current) => cycleTab(current, shown, event.shiftKey ? -1 : 1));
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [shown, design.closeGoes]);

  return (
    <main {...props(styles.page)}>
      <div {...props(styles.column)}>
        <header {...props(styles.header)}>
          <h1 {...props(styles.title)}>Window tabs</h1>
          <p {...props(styles.lede)}>
            The strip lives in the titlebar, as in Dia and Arc: pinned places as bare icons, then
            folders, then the chats you opened. The active tab wears the card below it. Switch the
            design above the window; <Kbd keys={["⌥", "1"]} plain />–
            <Kbd keys={["⌥", "9"]} plain /> jump, <Kbd keys={["⌥", "W"]} plain /> closes,{" "}
            <Kbd keys={["⌥", "T"]} plain /> opens, <Kbd keys={["⌥", "⇧", "T"]} plain /> reopens,{" "}
            <Kbd keys={["⌃", "Tab"]} plain /> cycles.
          </p>
        </header>

        <div role="toolbar" aria-label="Design" {...props(styles.toolbar)}>
          <Choice
            label="Active"
            value={design.active}
            options={[
              { value: "connected", label: "Connected" },
              { value: "card", label: "Card" },
              { value: "flat", label: "Flat" },
            ]}
            onChange={(active) => set("active", active)}
          />
          <Choice
            label="Others"
            value={design.inactive}
            options={[
              { value: "chip", label: "Chips" },
              { value: "ghost", label: "Ghost" },
            ]}
            onChange={(inactive) => set("inactive", inactive)}
          />
          <Choice
            label="Close"
            value={design.close}
            options={[
              { value: "beside", label: "Beside active" },
              { value: "active", label: "Inside active" },
              { value: "hover", label: "Inside on hover" },
            ]}
            onChange={(close) => set("close", close)}
          />
          <Choice
            label="Width"
            value={design.width}
            options={[
              { value: "shrink", label: "Shrink to icon" },
              { value: "fixed", label: "Fixed, scroll" },
            ]}
            onChange={(width) => set("width", width)}
          />
          <Choice
            label="Status"
            value={design.status}
            options={[
              { value: "badge", label: "Badge on icon" },
              { value: "glyph", label: "Replaces icon" },
              { value: "dot", label: "After title" },
            ]}
            onChange={(status) => set("status", status)}
          />
          <span {...props(styles.toolbarRule)} />
          <Choice
            label="Pinned"
            value={design.pinned}
            options={[
              { value: "icon", label: "Icon" },
              { value: "label", label: "Icon + title" },
              { value: "off", label: "None" },
            ]}
            onChange={(pinned) => set("pinned", pinned)}
          />
          <Flag label="Folders" checked={design.folders} onChange={(on) => set("folders", on)} />
          <Flag label="Dividers" checked={design.dividers} onChange={(on) => set("dividers", on)} />
          <span {...props(styles.toolbarRule)} />
          <Choice
            label="On close"
            value={design.closeGoes}
            options={[
              { value: "recent", label: "Recent" },
              { value: "neighbour", label: "Neighbour" },
            ]}
            onChange={(closeGoes) => set("closeGoes", closeGoes)}
          />
          <Flag label="Sidebar" checked={design.sidebar} onChange={(on) => set("sidebar", on)} />
          <Choice
            label="Scheme"
            value={design.scheme}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onChange={(scheme) => set("scheme", scheme)}
          />
        </div>

        <div {...props(styles.window)}>
          <div {...props(styles.titlebar)}>
            <div {...props(styles.sidebarSlot, design.sidebar && styles.sidebarSlotOpen)}>
              <TrafficLights />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon="panel-left"
                aria-label={design.sidebar ? "Hide sidebar" : "Show sidebar"}
                onClick={() => set("sidebar", !design.sidebar)}
              />
              {!design.sidebar && (
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
                tabs={shown}
                activeId={state.active}
                design={design}
                stripRef={stripRef}
                onActivate={(id) => setState((current) => activate(current, id))}
                onClose={(id) => setState((current) => closeTab(current, id, design.closeGoes))}
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
                  {shown.map((tab) => (
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
          <div
            {...props(
              styles.body,
              design.sidebar && styles.bodyWithSidebar,
              connected && styles.bodyConnected,
            )}
          >
            {design.sidebar && (
              <Sidebar
                tabs={state.open}
                activeId={state.active}
                onOpen={(id) => setState((current) => activate(current, id))}
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
              <CardContent tab={active} />
            </div>
          </div>
        </div>

        <section {...props(styles.notes)}>
          <h2 {...props(styles.notesTitle)}>Design notes</h2>
          <ul {...props(styles.list)}>
            <Note title="Order">
              Pinned, folders, chats, left to right, each group behind a hairline. Dia keeps this
              order so the tabs that never close stay where your hand expects them. Pinned places
              are full-tab pages (Customize, Environments) and anything you pin; a pinned chat keeps
              its status.
            </Note>
            <Note title="Active: connected">
              The tab is painted in the card&apos;s colour and curves into it; it overlaps the
              card&apos;s hairline by a pixel so the two read as one sheet. The card squares its top
              corner only when the active tab sits flush with its edge, which happens with the
              sidebar open and the first tab active. Card keeps the shipped strip&apos;s look, a
              hairlined chip in the card&apos;s colour floating over the chrome; Flat is the
              quietest and loses the most at a glance.
            </Note>
            <Note title="Others: chips">
              Dia fills every inactive tab, so the row reads as a row of objects and the
              strip&apos;s bounds are visible without a border. Ghost is the shipped behaviour; it
              is calmer with few tabs and harder to scan with many. Decide after living with eight
              or more tabs.
            </Note>
            <Note title="Close">
              Dia puts one close button after the active tab, outside it. Nothing hides inside the
              other tabs, so a crowded strip has no reveal-on-hover surprises and the hit area never
              steals from the title. Inside on hover is the shipped behaviour and still the fastest
              for closing several background tabs in a row; a middle click does that in every
              variant.
            </Note>
            <Note title="Width: shrink to icon">
              Chat tabs share the row up to 176px and give up their title below 72px, so a full
              strip becomes a row of icons before it scrolls, as in the first Dia screenshot. The
              active tab keeps at least 96px so its title survives. Pinned and folder tabs never
              shrink. Fixed with scrolling is the shipped rule, kept for comparison.
            </Note>
            <Note title="Status">
              Badge keeps the place icon and pins a dot to its corner: blue pulsing while working,
              yellow when a run needs you, red on failure, blue when a background chat finished
              unread. Replaces icon is the sidebar&apos;s rule, which loses what the tab is while it
              runs. After title is the shipped strip&apos;s unread dot, and it disappears when a tab
              collapses to its icon, which is the case against it.
            </Note>
            <Note title="Space">
              With the sidebar hidden, Dia names the space where the sidebar toggle would be
              (&quot;Personal&quot;). Here it is the workspace folder, and it opens the same
              switcher as the sidebar&apos;s footer.
            </Note>
            <Note title="Overflow">
              The chevron at the trailing edge lists every tab and the last closed one, so nothing
              is lost when the strip collapses to icons. Hover shows the title and the tab&apos;s
              number; ⌘ in the product, ⌥ here because the browser keeps ⌘W and ⌘T.
            </Note>
            <Note title="On close">
              Recent goes to the tab you were on before, the way Arc does; Neighbour goes right,
              then left, the way Chrome does and the tabs doc currently says. Recent is better when
              you bounce between a chat and a review; Neighbour is more predictable while closing a
              run of tabs.
            </Note>
            <Note title="Not here">
              Drag to reorder, the right-click menu, and ⌘-click from the sidebar into a background
              tab are in the shipped strip and the tabs doc; they do not change with the design and
              are left out of this board.
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
  // Above the body, so the connected tab's one-pixel overlap paints over the card.
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
  // Starts where the card does, so a flush tab and the card share a wall.
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
    paddingTop: shell.cardInset,
    backgroundColor: role.sidebarMaterial,
  },
  bodyWithSidebar: { gridTemplateColumns: `${sidebar.width} minmax(0, 1fr)` },
  bodyConnected: { paddingTop: 0 },
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
    borderRadius: radius.card,
    backgroundColor: role.bgBase,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    transitionProperty: "border-radius",
    transitionDuration: motionTokens.durationNormal,
    transitionTimingFunction: motionTokens.easeOut,
  },
  // A 1px corner, not 0, keeps the hairline continuous where the tab meets the card.
  cardSquareLeft: { borderStartStartRadius: 1 },
  cardSquareRight: { borderStartEndRadius: 1 },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingBlock: 10,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
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
