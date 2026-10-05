/**
 * Variant C from `page.tsx`, taken further. The sidebar's account row is the
 * one piece of chrome every window already has; its menu is where sign-in
 * state lives (`packages/app/src/chrome/account-footer.tsx`). The update
 * becomes one more account-ish fact: a dot on the row, a group in the menu.
 *
 * Questions worked here: where the dot sits, how the menu says it, what the
 * blocked and failed moments read like, and what the first launch after a
 * restart shows.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement, type ReactNode } from "react";
import { avatar, glyph, menu, radius } from "@nyte-ai/ui/schema.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/vars.stylex";

const FROM = "0.2.0";

const TO = "0.3.0";

const PERCENT = 42;

const PHASES = ["available", "downloading", "ready", "blocked", "failed", "updated"] as const;

type Phase = (typeof PHASES)[number];

const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  available: "Available",
  downloading: "Downloading",
  ready: "Ready",
  blocked: "Blocked",
  failed: "Failed",
  updated: "After restart",
};

type Tone = "accent" | "warn" | "none";

const TONE: Readonly<Record<Phase, Tone>> = {
  available: "accent",
  downloading: "accent",
  ready: "accent",
  blocked: "warn",
  failed: "warn",
  updated: "none",
};

function Dot({ tone, pulse }: { readonly tone: Tone; readonly pulse?: boolean }): ReactElement {
  return (
    <i
      {...props(
        styles.dot,
        tone === "accent" && styles.dotAccent,
        tone === "warn" && styles.dotWarn,
        pulse === true && styles.dotPulse,
      )}
      aria-hidden
    />
  );
}

/* ------------------------------------------------------------------------ */
/* The row                                                                  */
/* ------------------------------------------------------------------------ */

type DotPlacement = "avatar" | "trailing" | "label" | "none";

function FooterRow({
  phase,
  placement,
  open,
  onToggle,
}: {
  readonly phase: Phase;
  readonly placement: DotPlacement;
  readonly open?: boolean;
  readonly onToggle?: () => void;
}): ReactElement {
  const tone = TONE[phase];
  const shown = tone !== "none" && placement !== "none";

  return (
    <button
      {...props(styles.row, open === true && styles.rowOpen)}
      onClick={onToggle}
      aria-expanded={open}
    >
      <span {...props(styles.avatarWrap)}>
        <span {...props(styles.avatar)}>W</span>
        {shown && placement === "avatar" && (
          <span {...props(styles.avatarBadge)}>
            <Dot tone={tone} pulse={phase === "downloading"} />
          </span>
        )}
      </span>
      <span {...props(styles.rowLabel)}>
        workgyver
        {shown && placement === "label" && (
          <span {...props(styles.labelDot)}>
            <Dot tone={tone} pulse={phase === "downloading"} />
          </span>
        )}
      </span>
      {shown && placement === "trailing" && (
        <span {...props(styles.trailing)}>
          {phase === "downloading" ? (
            <span {...props(styles.trailingText)}>{String(PERCENT)}%</span>
          ) : (
            <Dot tone={tone} />
          )}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------------ */
/* The menu                                                                 */
/* ------------------------------------------------------------------------ */

type MenuTreatment = "group" | "footer" | "header";

interface UpdateItem {
  readonly icon: string;
  readonly label: string;
  readonly sub?: string;
  readonly meta?: ReactNode;
  readonly disabled?: boolean;
}

/** What the update group says, per phase. Label, optional sub-line, trailing meta. */
function updateItem(phase: Phase): UpdateItem {
  switch (phase) {
    case "available":
      return { icon: "↓", label: `Update to Nyte ${TO}`, meta: "Download" };
    case "downloading":
      return {
        icon: "↓",
        label: `Downloading Nyte ${TO}`,
        meta: (
          <span {...props(styles.meter)}>
            <span {...props(styles.meterFill)} style={{ width: `${String(PERCENT)}%` }} />
          </span>
        ),
        disabled: true,
      };
    case "ready":
      return { icon: "↻", label: "Restart to Update", sub: `Nyte ${TO} is downloaded` };
    case "blocked":
      return {
        icon: "↻",
        label: "Restart to Update",
        sub: "Waits for 2 running tasks · Restart now",
      };
    case "failed":
      return {
        icon: "!",
        label: `Couldn't download Nyte ${TO}`,
        sub: "Your install is untouched · Try again",
      };
    case "updated":
      return { icon: "✓", label: `Nyte ${TO}`, sub: "Updated just now · What's new" };
    default: {
      const _exhaustive: never = phase;

      return _exhaustive;
    }
  }
}

function MenuRow({
  icon,
  children,
  sub,
  meta,
  tone,
  disabled,
}: {
  readonly icon: string;
  readonly children: ReactNode;
  readonly sub?: string;
  readonly meta?: ReactNode;
  readonly tone?: Tone;
  readonly disabled?: boolean;
}): ReactElement {
  return (
    <div {...props(styles.item, disabled === true && styles.itemDisabled)}>
      <span
        {...props(
          styles.itemIcon,
          tone === "accent" && styles.accentText,
          tone === "warn" && styles.warnText,
        )}
      >
        {icon}
      </span>
      <span {...props(styles.itemBody)}>
        <span {...props(styles.itemLabel)}>{children}</span>
        {sub !== undefined && <span {...props(styles.itemSub)}>{sub}</span>}
      </span>
      {meta !== undefined && <span {...props(styles.itemMeta)}>{meta}</span>}
    </div>
  );
}

function AccountMenu({
  phase,
  treatment,
}: {
  readonly phase: Phase;
  readonly treatment: MenuTreatment;
}): ReactElement {
  const item = updateItem(phase);
  const tone = TONE[phase];

  const update = (
    <MenuRow icon={item.icon} sub={item.sub} meta={item.meta} tone={tone} disabled={item.disabled}>
      {item.label}
    </MenuRow>
  );

  const accounts = (
    <>
      <div {...props(styles.group)}>
        <span {...props(styles.groupLabel)}>GitHub</span>
        <MenuRow icon="◉">workgyver</MenuRow>
      </div>
      <div {...props(styles.group)}>
        <span {...props(styles.groupLabel)}>Nyte account</span>
        <MenuRow icon="◯">work@gyver.dev</MenuRow>
      </div>
    </>
  );

  return (
    <div {...props(styles.menu)}>
      {treatment === "header" && (
        <>
          <div {...props(styles.headerStrip, tone === "warn" && styles.headerStripWarn)}>
            {update}
          </div>
          <div {...props(styles.separator)} />
        </>
      )}
      {accounts}
      {treatment === "group" && (
        <div {...props(styles.group)}>
          <span {...props(styles.groupLabel)}>
            Nyte {phase === "updated" ? TO : FROM}
            {phase !== "updated" && (
              <span {...props(styles.groupLabelDot)}>
                <Dot tone={tone} />
              </span>
            )}
          </span>
          {update}
        </div>
      )}
      <div {...props(styles.separator)} />
      <MenuRow icon="♡">Give Feedback</MenuRow>
      {treatment === "footer" && (
        <>
          <div {...props(styles.separator)} />
          {update}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Sidebar crop                                                             */
/* ------------------------------------------------------------------------ */

function SidebarCrop({
  phase,
  placement,
  treatment,
  defaultOpen = false,
}: {
  readonly phase: Phase;
  readonly placement: DotPlacement;
  readonly treatment: MenuTreatment;
  readonly defaultOpen?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div {...props(styles.crop, open && styles.cropOpen)}>
      <div {...props(styles.cropRows)}>
        <div {...props(styles.cropRow)}>Fix tar listing</div>
        <div {...props(styles.cropRow)}>Review guide copy</div>
      </div>
      <div {...props(styles.anchor)}>
        {open && <AccountMenu phase={phase} treatment={treatment} />}
        <FooterRow
          phase={phase}
          placement={placement}
          open={open}
          onToggle={() => setOpen((value) => !value)}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Section                                                                  */
/* ------------------------------------------------------------------------ */

function Study({
  name,
  note,
  children,
}: {
  readonly name: string;
  readonly note: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section {...props(styles.study)}>
      <header {...props(styles.studyHeader)}>
        <h3 {...props(styles.studyName)}>{name}</h3>
        <p {...props(styles.studyNote)}>{note}</p>
      </header>
      <div {...props(styles.studyBody)}>{children}</div>
    </section>
  );
}

function Labelled({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.labelled)}>
      {children}
      <span {...props(styles.labelledText)}>{label}</span>
    </div>
  );
}

export function AccountRowStudies(): ReactElement {
  const [phase, setPhase] = useState<Phase>("ready");
  const [placement, setPlacement] = useState<DotPlacement>("avatar");
  const [treatment, setTreatment] = useState<MenuTreatment>("group");

  return (
    <div {...props(styles.section)}>
      <div {...props(styles.controls)}>
        <ToggleGroup
          aria-label="Phase"
          value={[phase]}
          onValueChange={(values) => {
            const last = values.at(-1);
            const next = PHASES.find((candidate) => candidate === last);

            if (next !== undefined) setPhase(next);
          }}
        >
          {PHASES.map((candidate) => (
            <Toggle key={candidate} value={candidate}>
              {PHASE_LABEL[candidate]}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>

      <Study
        name="C1 · Where the dot sits"
        note="Click a row to compare it open. The avatar corner reads like a presence badge; trailing leaves room for a percent; on the label it competes with the name."
      >
        {(["avatar", "trailing", "label", "none"] as const).map((candidate) => (
          <Labelled key={candidate} label={candidate}>
            <button
              {...props(styles.pick, placement === candidate && styles.pickOn)}
              onClick={() => setPlacement(candidate)}
            >
              <SidebarCrop phase={phase} placement={candidate} treatment={treatment} />
            </button>
          </Labelled>
        ))}
      </Study>

      <Study
        name="C2 · Where the menu says it"
        note={
          <>
            <b>group</b> adds a third account-like group, labelled with the running version.{" "}
            <b>footer</b> tucks it under Give Feedback. <b>header</b> pins a strip at the top, which
            is the loudest and the only one that works without opening a group.
          </>
        }
      >
        {(["group", "footer", "header"] as const).map((candidate) => (
          <Labelled key={candidate} label={candidate}>
            <button
              {...props(styles.pick, treatment === candidate && styles.pickOn)}
              onClick={() => setTreatment(candidate)}
            >
              <SidebarCrop phase={phase} placement={placement} treatment={candidate} defaultOpen />
            </button>
          </Labelled>
        ))}
      </Study>

      <Study
        name="C3 · Every phase, picked settings"
        note="The whole arc in one strip. The dot leaves after a restart and the group label simply reads the new version for that session."
      >
        {PHASES.map((candidate) => (
          <Labelled key={candidate} label={PHASE_LABEL[candidate]}>
            <SidebarCrop
              phase={candidate}
              placement={placement}
              treatment={treatment}
              defaultOpen
            />
          </Labelled>
        ))}
      </Study>
    </div>
  );
}

const styles = create({
  section: { display: "flex", flexDirection: "column", gap: 32 },
  controls: { display: "flex", flexWrap: "wrap", gap: 12 },
  study: { display: "flex", flexDirection: "column", gap: 12 },
  studyHeader: { display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 },
  studyName: { margin: 0, fontSize: type.fontBase, fontWeight: 600 },
  studyNote: { margin: 0, fontSize: type.fontSm, color: role.contentTertiary },
  studyBody: { display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" },
  labelled: { display: "flex", flexDirection: "column", gap: 6 },
  labelledText: { fontSize: type.fontXs, color: role.contentTertiary, fontFamily: type.fontMono },

  pick: {
    padding: 0,
    borderStyle: "none",
    borderRadius: radius.card,
    backgroundColor: "transparent",
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineColor: "transparent",
    outlineOffset: 2,
    cursor: "pointer",
    textAlign: "left",
  },
  pickOn: { outlineColor: role.borderInteractivePrimary },

  crop: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    width: 220,
    height: 150,
    padding: 8,
    borderRadius: radius.card,
    backgroundColor: role.bgChrome,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    fontSize: type.fontSm,
    overflow: "visible",
  },
  cropOpen: { height: 340 },
  cropRows: { display: "flex", flexDirection: "column", gap: 2, marginBottom: "auto" },
  cropRow: {
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: radius.control,
    color: role.contentTertiary,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  anchor: { position: "relative" },

  /* row */
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    paddingBlock: 6,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    color: role.contentSecondary,
    textAlign: "left",
    cursor: "pointer",
  },
  rowOpen: { backgroundColor: role.bgControlSelected, color: role.contentPrimary },
  rowLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  labelDot: { display: "inline-flex" },
  trailing: { display: "inline-flex", alignItems: "center", paddingInline: 2 },
  trailingText: { fontSize: type.fontXs, color: role.contentInteractivePrimary, fontWeight: 500 },
  avatarWrap: { position: "relative", display: "inline-flex", flexShrink: 0 },
  avatar: {
    display: "inline-grid",
    placeItems: "center",
    width: avatar.xs,
    height: avatar.xs,
    borderRadius: "50%",
    backgroundColor: role.bgControl,
    fontSize: type.fontXs,
    fontWeight: 600,
  },
  avatarBadge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    display: "grid",
    placeItems: "center",
    padding: 2,
    borderRadius: "50%",
    backgroundColor: role.bgChrome,
  },

  dot: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  dotAccent: { backgroundColor: role.bgInteractivePrimary },
  dotWarn: { backgroundColor: "var(--nyte-content-warning, #d9822b)" },
  dotPulse: {
    animationName: "none",
    opacity: 0.7,
  },
  accentText: { color: role.contentInteractivePrimary },
  warnText: { color: "var(--nyte-content-warning, #d9822b)" },

  /* menu */
  menu: {
    position: "absolute",
    bottom: "calc(100% + 4px)",
    left: 0,
    right: 0,
    zIndex: 1,
    padding: menu.padding,
    borderRadius: menu.radius,
    backgroundColor: role.bgElevated,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}, 0 8px 24px rgb(0 0 0 / 0.18)`,
  },
  group: { display: "flex", flexDirection: "column" },
  groupLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    paddingBlock: 4,
    paddingInline: menu.itemPaddingInline,
    fontSize: type.fontXs,
    fontWeight: 500,
    color: role.contentTertiary,
  },
  groupLabelDot: { display: "inline-flex" },
  separator: {
    marginBlock: 4,
    marginInline: menu.itemPaddingInline,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondaryTranslucent,
  },
  headerStrip: {
    marginBottom: 2,
    borderRadius: menu.itemRadius,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
  },
  headerStripWarn: { backgroundColor: "rgb(217 130 43 / 0.12)" },
  item: {
    display: "flex",
    alignItems: "center",
    gap: menu.itemGap,
    paddingBlock: menu.itemPaddingBlock,
    paddingInline: menu.itemPaddingInline,
    borderRadius: menu.itemRadius,
    color: { default: role.contentSecondary, ":hover": role.contentPrimary },
  },
  itemDisabled: { color: role.contentDisabled },
  itemIcon: {
    display: "inline-grid",
    placeItems: "center",
    width: glyph.sm,
    fontSize: type.fontXs,
    flexShrink: 0,
  },
  itemBody: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
  itemLabel: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  itemSub: {
    fontSize: type.fontXs,
    color: role.contentTertiary,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  itemMeta: {
    marginLeft: "auto",
    fontSize: type.fontXs,
    color: role.contentInteractivePrimary,
    fontWeight: 500,
    flexShrink: 0,
  },
  meter: {
    display: "inline-block",
    width: 48,
    height: 3,
    borderRadius: 2,
    backgroundColor: role.bgControl,
    overflow: "hidden",
    verticalAlign: "middle",
  },
  meterFill: { display: "block", height: "100%", backgroundColor: role.bgInteractivePrimary },
});
