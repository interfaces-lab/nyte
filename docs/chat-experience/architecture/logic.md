# Shell logic

How the chat shell decides what to show. The first graph is today, traced in [grounding.md](grounding.md). The rest are the target: one owner per concept, and the gates every surface goes through. The target follows the Opus candidate and is redrawn after synthesis with the other two candidates.

## Today: one fact, many deciders

```mermaid
flowchart LR
  subgraph Sources
    W["sessionsWatch<br/>session list"]
    V["session view<br/>execution, messages"]
    H["host's one open folder"]
    P["panes, tabs, window focus"]
  end

  subgraph Run["Run status: ~9 mappings"]
    R1["sidebar glyph"]
    R2["tab glyph"]
    R3["agents tray"]
    R4["composer busy"]
    R5["toast"]
    R6["announcer"]
  end

  subgraph Look["Is the user looking: ~10 answers"]
    L1["mark seen effect"]
    L2["tab unread dot"]
    L3["toast filter"]
    L4["plugin focused chat"]
    L5["text pacing"]
  end

  subgraph Place["Opening a chat: 2 layers"]
    O1["window tabs<br/>dedupe, URL sync"]
    O2["pane controller<br/>no dedupe, no URL"]
  end

  W --> R1 & R2 & R5
  V --> R3 & R4 & R6
  P --> L1 & L2 & L3 & L4 & L5
  H --> C["hover card, paths,<br/>right panel"]
  O1 -.->|"sidebar, palette"| P
  O2 -.->|"subagent open, drag,<br/>draft becomes chat"| P
```

The same question gets different answers depending on where it's asked: a stopped subagent reads as failed in one surface and done in another; the toast fires for the chat on screen; a chat's repo comes from the window, not the chat.

## Target: three owners, one direction

```mermaid
flowchart TB
  subgraph Data["Data (sdk streams)"]
    SW["session list"]
    SV["session view"]
    WS["workspaces"]
  end

  subgraph Chats["chats/: true in any window"]
    DIR["ChatDirectory<br/>one Chat per id"]
    RS["runState<br/>7 states"]
    FOLD["ChatFolder<br/>per chat: path, worktree,<br/>branch, machine"]
  end

  subgraph Window["window/: this window"]
    TABS["tabs + one preview slot"]
    OPEN["openChat(chat, intent)"]
    SCREEN["deriveScreen<br/>shown, covered,<br/>attended, focused"]
    FOCUS["FocusRequest<br/>one per window"]
    VIEW["ChatViewState<br/>keyed by chat id"]
  end

  subgraph Attention["attention/: status x looking"]
    LOOK["statusLook(status, looking)"]
    MARK["read mark"]
    NOTICE["notices / toast"]
    VISIT["unread visit:<br/>divider + pills"]
  end

  subgraph Surfaces
    S1["sidebar row"]
    S2["tab"]
    S3["hover card"]
    S4["transcript"]
    S5["composer"]
    S6["agents tray"]
  end

  SW & SV & WS --> DIR
  DIR --> RS & FOLD
  DIR --> OPEN --> TABS --> SCREEN
  SCREEN --> LOOK & MARK & NOTICE & VISIT
  RS --> LOOK & NOTICE
  LOOK --> S1 & S2 & S6
  FOLD --> S3
  VISIT --> S4
  RS --> S5
  FOCUS --> S5
  VIEW --> S4 & S5
```

Imports go one way: surfaces → `attention/` → `window/` → `chats/` → data. Each concept folder is reachable only through its `index.ts`.

## Gate 1: is the user looking at this chat?

One function over state, never over what happens to be mounted. Every reader (read mark, unread dot, toast, pacing) asks this gate.

```mermaid
flowchart LR
  A{"chat shown in a pane<br/>or in front as a page?"} -->|no| N["not looking"]
  A -->|yes| B{"covered by the workbench<br/>or a tray detail?"}
  B -->|yes| N
  B -->|no| C{"window focused?"}
  C -->|no| S["shown, not attended:<br/>counts as seen later,<br/>still notifies"]
  C -->|yes| Y["looking"]
```

## Gate 2: what a row or tab shows

```mermaid
flowchart LR
  RS["runState"] --> W{"working, or a<br/>subagent still working?"}
  W -->|yes| G1["working glyph"]
  W -->|no| AP{"waiting for approval?"}
  AP -->|yes| G2["approval glyph"]
  AP -->|no| F{"failed?"}
  F -->|yes| G3["error glyph,<br/>unread unless looking"]
  F -->|no| U{"new since the read mark<br/>and not looking?"}
  U -->|yes| G4["unread dot"]
  U -->|no| G5["idle"]
```

## Gate 3: the read mark and the "New" divider

```mermaid
flowchart TB
  O["chat opens: visit starts"] --> D{"messages after the<br/>read mark?"}
  D -->|yes| DIV["divider above the first one,<br/>fixed for this visit"]
  D -->|no| NODIV["no divider"]
  O --> L{"Gate 1: looking?"}
  L -->|yes| ADV["advance read mark<br/>to the tip"]
  L -->|no| HOLD["mark stays"]
  NEW["new rows arrive"] --> F{"following the end<br/>(within 4 px)?"}
  F -->|yes| SCROLL["stay at the end"]
  F -->|no| PILL["pill: N New Messages,<br/>click jumps, x dismisses"]
  LEAVE["leave the chat"] --> CLEAR["divider cleared"]
```

## Gate 4: opening a chat

Every caller (sidebar click, palette, subagent link, "Open as full chat", drag, draft becoming a chat) goes through one entry with an intent.

```mermaid
flowchart TB
  I["openChat(chat, intent)"] --> E{"already shown<br/>in this window?"}
  E -->|yes| REV["reveal that tab"]
  E -->|no| K{"intent"}
  K -->|preview| P{"preview slot used?"}
  P -->|yes| REP["replace the preview in place;<br/>not offered by reopen"]
  P -->|no| NEWP["open italic preview tab"]
  K -->|permanent| T["new tab, focused"]
  K -->|background| BG["new tab, not focused"]
  K -->|child of parent| NX["preview right after the parent;<br/>parent stays"]
  REP & NEWP & T & NX --> FS{"chat in another folder?"}
  FS -->|yes| SW["switch the host folder first;<br/>abort if it fails"]
  FS -->|no| DONE["placed"]
  SW --> DONE
```

A preview becomes permanent on double-click, Keep Open, drag, split, or a sent message.

## Gate 5: what Enter does in the composer

One function, `enterBehavior`, gives the placeholder, the send tooltip and the delivery.

```mermaid
flowchart LR
  S{"composer state"} -->|"subagent tab"| LOCK["locked: follow-ups<br/>aren't available"]
  S -->|"editing a message"| ED["save the edit"]
  S -->|"answering a question"| ANS["send the answer"]
  S -->|idle| SEND["send"]
  S -->|"run working"| M{"Enter setting,<br/>model can steer?"}
  M -->|"steer and can steer"| ST["placeholder: Steer without stopping<br/>Enter steers"]
  M -->|"queue, or can't steer"| Q["placeholder: Queue for next turn<br/>Enter queues"]
```

## Gate 6: should a toast appear?

```mermaid
flowchart LR
  R["run finished or failed"] --> L{"Gate 1: chat shown<br/>in any pane?"}
  L -->|yes| QUIET["no toast"]
  L -->|no| TOAST["toast: Run finished / Run failed"]
```
