/**
 * The account as a member passport. Closed, it is a cover with the moon on
 * it. Open, the cover swings back on its spine to show the identity page,
 * with the stamps page beside it on a wide screen and below it on a narrow one.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { Avatar, AvatarFallback } from "@nyte-ai/ui/avatar";
import { Button } from "@nyte-ai/ui/button";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { appearance, motion, role, shadow, type } from "@nyte-ai/ui/vars.stylex";
import { HOLDER, STAMPS, TOTALS, formatDate } from "./fixtures";
import { Guilloche } from "./guilloche";
import { Moon } from "./moon";
import { StampMark } from "./stamp";

/* The machine-readable zone: two 44-character lines, `<` for every gap. */
function mrzLine(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9<]/g, "<")
    .padEnd(44, "<")
    .slice(0, 44);
}

const MRZ = [
  mrzLine(`P<NYT${HOLDER.surname}<<${HOLDER.givenName}`),
  mrzLine(
    `${HOLDER.accountId.replace("usr_", "")}<<${HOLDER.registeredAt.slice(2).replaceAll("-", "")}<${HOLDER.plan}<<${HOLDER.handle}`,
  ),
] as const;

const FULL_NAME = `${HOLDER.givenName} ${HOLDER.surname}`;

const INITIALS = `${HOLDER.givenName[0]}${HOLDER.surname[0]}`;

type Copy = "idle" | "copied" | "failed";

function AccountId(): ReactElement {
  const [copy, setCopy] = useState<Copy>("idle");

  useEffect(() => {
    if (copy === "idle") return;

    const timer = setTimeout(() => setCopy("idle"), 1600);

    return () => clearTimeout(timer);
  }, [copy]);

  return (
    <span {...props(styles.idRow)}>
      <span {...props(styles.mono)}>{HOLDER.accountId}</span>
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        icon={copy === "copied" ? "checkmark" : "copy"}
        aria-label="Copy account ID"
        onClick={() => {
          Promise.resolve()
            .then(() => navigator.clipboard.writeText(HOLDER.accountId))
            .then(
              () => setCopy("copied"),
              () => setCopy("failed"),
            );
        }}
      />
      <span role="status" {...props(styles.copyStatus)}>
        {copy === "copied" ? "Copied" : copy === "failed" ? "Couldn't copy" : ""}
      </span>
    </span>
  );
}

function Field({
  label,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: ReactElement | string;
}): ReactElement {
  return (
    <div {...props(styles.field, wide && styles.fieldWide)}>
      <dt {...props(styles.label)}>{label}</dt>
      <dd {...props(styles.value)}>{children}</dd>
    </div>
  );
}

export function Passport({
  id,
  open,
  onOpenChange,
}: {
  readonly id: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const nameRef = useRef<HTMLHeadingElement>(null);
  const coverRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<"name" | "cover" | null>(null);

  // Whichever face is leaving goes inert, so focus follows to the one arriving.
  useEffect(() => {
    const target = focusAfter.current === "name" ? nameRef.current : coverRef.current;

    if (focusAfter.current !== null) target?.focus({ preventScroll: true });
    focusAfter.current = null;
  }, [open]);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !open) return;

    focusAfter.current = "cover";
    onOpenChange(false);
  };

  return (
    <div {...props(styles.stage)}>
      <div id={id} onKeyDown={onKeyDown} {...props(styles.book, !open && styles.bookClosed)}>
        <span aria-hidden="true" {...props(styles.binding, !open && styles.bindingClosed)} />
        <section
          aria-labelledby={`${id}-name`}
          inert={!open}
          {...props(styles.page, styles.identity, !open && styles.identityClosed)}
        >
          <span aria-hidden="true" {...props(surfaceTheme.blue, styles.security)}>
            <Guilloche />
          </span>
          <header {...props(styles.pageHeader)}>
            <span {...props(styles.brand)}>
              <Moon size={14} />
              Nyte
            </span>
            <span {...props(styles.headerNote)}>Member passport</span>
          </header>

          <div {...props(styles.holder)}>
            <Avatar tone="blue" xstyle={styles.photo}>
              <AvatarFallback xstyle={styles.backdrop}>{INITIALS}</AvatarFallback>
            </Avatar>
            <div {...props(styles.holderText)}>
              <h2 ref={nameRef} id={`${id}-name`} tabIndex={-1} {...props(styles.name)}>
                {FULL_NAME}
              </h2>
              <span {...props(styles.handle)}>@{HOLDER.handle}</span>
            </div>
          </div>

          <dl {...props(styles.fields)}>
            <Field label="Member since">
              <time dateTime={HOLDER.registeredAt}>{formatDate(HOLDER.registeredAt)}</time>
            </Field>
            <Field label="Plan">{HOLDER.plan}</Field>
            <Field label="Email" wide>
              {HOLDER.email}
            </Field>
            <Field label="Time zone" wide>
              {HOLDER.timeZone}
            </Field>
            <Field label="Account ID" wide>
              <AccountId />
            </Field>
          </dl>

          <p aria-hidden="true" {...props(styles.mrz)}>
            <span>{MRZ[0]}</span>
            <span>{MRZ[1]}</span>
          </p>
        </section>

        <section
          aria-labelledby={`${id}-stamps`}
          inert={!open}
          {...props(styles.page, styles.stamps, open ? styles.stampsOpen : styles.stampsClosed)}
        >
          <header {...props(styles.pageHeader)}>
            <h2 id={`${id}-stamps`} {...props(styles.brand)}>
              Stamps
            </h2>
            <span aria-hidden="true" {...props(styles.headerNote, styles.folio)}>
              2
            </span>
          </header>
          <ol {...props(styles.stampGrid)}>
            {STAMPS.map((stamp, index) => (
              <StampMark
                key={`${stamp.title}-${stamp.date}`}
                stamp={stamp}
                id={`${id}-stamp-${String(index)}`}
              />
            ))}
          </ol>
          <dl {...props(styles.totals)}>
            {TOTALS.map((total) => (
              <div key={total.label} {...props(styles.total)}>
                <dt {...props(styles.label)}>{total.label}</dt>
                <dd {...props(styles.totalValue)}>{total.value.toLocaleString("en-US")}</dd>
              </div>
            ))}
          </dl>
        </section>

        <button
          ref={coverRef}
          type="button"
          inert={open}
          aria-label={`Open ${FULL_NAME}'s member passport`}
          onClick={() => {
            focusAfter.current = "name";
            onOpenChange(true);
          }}
          {...props(styles.cover, open && styles.coverOpen)}
        >
          <span {...props(styles.coverInk)}>
            <span {...props(styles.wordmark)}>Nyte</span>
            <span {...props(styles.emblem)}>
              <Moon size={104} />
            </span>
            <span {...props(styles.coverTitle)}>Member passport</span>
            <span {...props(styles.coverName)}>{FULL_NAME}</span>
          </span>
        </button>
      </div>
    </div>
  );
}

/* The two-page spread fits once the stage can hold two 360px pages. */
const WIDE = "@container (min-width: 760px)";

const MOTION = "@media (prefers-reduced-motion: no-preference)";

const PEEK = "@media (hover: hover) and (prefers-reduced-motion: no-preference)";

/* DERIVED: long enough to read the cover passing the spine, short enough not to wait on. */
const FLIP = "720ms";

/* DERIVED: the plate gradient and moon of public/icon.svg. The cover is a printed object, so it keeps them in both appearances. */
const COVER_TOP = "#232a44";

const COVER_BOTTOM = "#0c1020";

const COVER_INK = "#c1d0f6";

/* Pebbled leather: fractal noise, kept only where it runs dark, so the grain reads as relief without catching light. */
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1.8 0 0 0 -0.7'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E")`;

const LEATHER = `${GRAIN}, linear-gradient(${COVER_TOP}, ${COVER_BOTTOM})`;

const OVERHANG = "-6px";

/* DERIVED: a breath of warmth on white, so the page reads as paper. Dark keeps the neutral surface. */
const PAPER = `light-dark(color-mix(in oklab, ${role.bgElevated} 96%, #b8955a), ${role.bgElevated})`;

/* The gutter only ever darkens. A tint of the content colour would light it up in dark mode. */
const GUTTER = "light-dark(rgb(0 0 0 / 0.07), rgb(0 0 0 / 0.32))";

const PAGE_SHADOW = `0 0 0 1px ${role.borderSecondaryTranslucent}, ${shadow.shadowLg}`;

/* The leaves under each open page, stepping out toward its fore-edge. */
const LEAF = `color-mix(in oklab, ${PAPER} 88%, #000)`;

const LEAF_UNDER = `color-mix(in oklab, ${PAPER} 78%, #000)`;

const SPREAD_EDGE = "0 0 0 0.5px rgb(0 0 0 / 0.4)";

/* One page at the passport's 88 × 125 proportion. */
const PAGE_HEIGHT = "calc(min(100cqi, 400px) * 125 / 88)";

const settle = keyframes({
  from: { opacity: 0, transform: "translateY(8px)" },
  to: { opacity: 1, transform: "none" },
});

const styles = create({
  stage: {
    containerType: "inline-size",
    display: "flex",
    justifyContent: "center",
    inlineSize: "100%",
  },
  book: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 400px)", [WIDE]: "repeat(2, 360px)" },
    gridTemplateAreas: { default: '"identity" "stamps"', [WIDE]: '"identity stamps"' },
    rowGap: 16,
    inlineSize: { default: "100%", [WIDE]: "auto" },
    perspective: "2400px",
    transform: "none",
    transitionProperty: "transform",
    transitionDuration: { default: "0s", [MOTION]: FLIP },
    transitionTimingFunction: motion.easeInOutStrong,
  },
  bookClosed: {
    transform: { default: "none", [WIDE]: "translateX(-25%)" },
  },

  /* The inside of the cover, showing a few millimetres past the pages once the book lies open. */
  binding: {
    display: { default: "none", [WIDE]: "block" },
    gridColumn: "1 / -1",
    gridRow: 1,
    margin: OVERHANG,
    borderRadius: 12,
    backgroundColor: COVER_BOTTOM,
    backgroundImage: LEATHER,
    backgroundSize: "160px 160px, auto",
    boxShadow: shadow.shadowXl,
    opacity: 1,
    transitionProperty: "opacity",
    transitionDuration: "180ms",
    transitionDelay: { default: "0s", [MOTION]: "300ms" },
  },
  bindingClosed: {
    opacity: 0,
    transitionDuration: "120ms",
    transitionDelay: "0s",
  },

  page: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    minBlockSize: { default: PAGE_HEIGHT, [WIDE]: "512px" },
    padding: { default: 20, [WIDE]: 28 },
    overflow: "clip",
    containerType: "inline-size",
    backgroundColor: PAPER,
    boxShadow: PAGE_SHADOW,
  },
  identity: {
    gridArea: "identity",
    borderRadius: { default: 10, [WIDE]: "6px 2px 2px 6px" },
    boxShadow: {
      default: PAGE_SHADOW,
      [WIDE]: `-1.5px 1px 0 -0.5px ${LEAF}, -3px 2px 0 -1px ${LEAF_UNDER}, ${SPREAD_EDGE}`,
    },
    backgroundImage: {
      default: null,
      [WIDE]: `linear-gradient(to left, ${GUTTER}, transparent 40px)`,
    },
    opacity: 1,
    transitionProperty: "opacity",
    transitionDuration: "180ms",
    transitionDelay: { default: "0s", [MOTION]: "300ms" },
  },
  identityClosed: {
    opacity: 0,
    transitionDuration: "120ms",
    transitionDelay: "0s",
  },
  stamps: {
    gridArea: "stamps",
    borderRadius: { default: 10, [WIDE]: "2px 6px 6px 2px" },
    boxShadow: {
      default: PAGE_SHADOW,
      [WIDE]: `1.5px 1px 0 -0.5px ${LEAF}, 3px 2px 0 -1px ${LEAF_UNDER}, ${SPREAD_EDGE}`,
    },
    backgroundImage: {
      default: null,
      [WIDE]: `linear-gradient(to right, ${GUTTER}, transparent 40px)`,
    },
  },
  stampsOpen: {
    animationName: { default: null, [MOTION]: settle },
    animationDuration: "320ms",
    animationDelay: "160ms",
    animationFillMode: "backwards",
    animationTimingFunction: motion.easeOutQuint,
  },
  stampsClosed: {
    display: { default: "none", [WIDE]: "flex" },
  },

  pageHeader: {
    position: "relative",
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontSm,
    fontWeight: 600,
    lineHeight: type.leadingSm,
  },
  headerNote: {
    color: role.contentTertiary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    whiteSpace: "nowrap",
  },
  folio: {
    fontVariantNumeric: "tabular-nums",
  },
  label: {
    margin: 0,
    color: role.contentTertiary,
    fontSize: type.fontXs,
    fontWeight: 500,
    lineHeight: type.leadingXs,
    whiteSpace: "nowrap",
  },
  security: {
    position: "absolute",
    insetInline: 0,
    insetBlockStart: 0,
    blockSize: "62%",
    color: `light-dark(color-mix(in oklab, ${role.contentInteractivePrimary} 22%, transparent), color-mix(in oklab, ${role.contentInteractivePrimary} 14%, transparent))`,
    maskImage: "linear-gradient(#000 20%, transparent)",
    pointerEvents: "none",
  },

  holder: {
    position: "relative",
    display: "flex",
    alignItems: "flex-end",
    gap: 16,
    marginBlockStart: 8,
  },
  photo: {
    width: 84,
    height: 108,
    borderRadius: 4,
    borderColor: role.borderSecondaryTranslucent,
    backgroundColor: PAPER,
    color: `color-mix(in oklab, ${role.contentInteractivePrimary} 70%, ${role.contentSecondary})`,
    fontSize: 26,
    fontWeight: 500,
    letterSpacing: "0.01em",
  },
  /* A studio backdrop, lit from above. */
  backdrop: {
    backgroundImage: `linear-gradient(color-mix(in oklab, ${role.contentInteractivePrimary} 6%, transparent), color-mix(in oklab, ${role.contentInteractivePrimary} 15%, transparent))`,
  },
  holderText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
    flexGrow: 1,
    paddingBlockEnd: 2,
  },
  name: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: { default: 22, [WIDE]: 24 },
    fontWeight: 600,
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
    overflowWrap: "anywhere",
    textWrap: "balance",
    outline: "none",
  },
  handle: {
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },

  fields: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "16px 16px",
    margin: 0,
    marginBlockStart: 4,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  fieldWide: { gridColumn: "1 / -1" },
  value: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    fontWeight: 500,
    lineHeight: type.leadingBase,
    overflowWrap: "anywhere",
  },
  idRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
    marginBlock: -2,
  },
  mono: {
    fontFamily: type.fontMono,
    fontSize: type.fontSm,
    overflowWrap: "anywhere",
  },
  copyStatus: {
    color: role.contentSecondary,
    fontSize: type.fontXs,
    fontWeight: 400,
    lineHeight: type.leadingXs,
  },

  mrz: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    marginBlockStart: "auto",
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    /* DERIVED: 44 monospace characters at about 0.6em each fill the line. */
    fontSize: "min(12px, 3.6cqi)",
    lineHeight: 1.6,
    whiteSpace: "pre",
    overflow: "clip",
    opacity: 0.8,
    userSelect: "none",
  },

  stampGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    alignContent: "start",
    gap: 8,
    flexGrow: 1,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },

  totals: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
    margin: 0,
    paddingBlockStart: 16,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: role.borderSecondaryTranslucent,
  },
  total: {
    display: "flex",
    flexDirection: "column-reverse",
    gap: 2,
  },
  totalValue: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: 22,
    fontWeight: 600,
    lineHeight: 1.1,
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
  },

  cover: {
    position: "relative",
    zIndex: 1,
    gridArea: { default: "identity", [WIDE]: "stamps" },
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minBlockSize: { default: PAGE_HEIGHT, [WIDE]: "512px" },
    /* On the spread the cover is the binding, so it overhangs the page by the same margin. */
    margin: { default: 0, [WIDE]: `${OVERHANG} ${OVERHANG} ${OVERHANG} 0` },
    paddingBlock: 52,
    paddingInline: 24,
    borderWidth: 0,
    borderRadius: "3px 12px 12px 3px",
    backgroundColor: COVER_BOTTOM,
    /* The hinge: a pressed line where the cover folds, a few millimetres in from the spine. */
    backgroundImage: `linear-gradient(to right, transparent 14px, rgb(0 0 0 / 0.35) 14px 15px, transparent 15px), ${LEATHER}`,
    backgroundSize: "auto, 160px 160px, auto",
    boxShadow: `inset 12px 0 14px -12px rgb(0 0 0 / 0.6), ${shadow.shadowXl}`,
    cursor: appearance.cursorInteractive,
    textAlign: "center",
    transformOrigin: "left center",
    backfaceVisibility: "hidden",
    transform: {
      default: "none",
      ":hover": { default: null, [PEEK]: "rotateY(-14deg)" },
    },
    opacity: 1,
    transitionProperty: "transform, opacity",
    transitionDuration: {
      default: "0s, 150ms",
      [MOTION]: `${FLIP}, 0s`,
      ":hover": { default: null, [MOTION]: "360ms, 0s" },
    },
    transitionDelay: "0s",
    transitionTimingFunction: motion.easeInOutStrong,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 2,
    outlineOffset: 4,
    outlineColor: appearance.focusRing,
  },
  coverOpen: {
    transform: { default: "none", [MOTION]: "rotateY(-180deg)" },
    opacity: 0,
    transitionDuration: { default: "0s, 150ms", [MOTION]: `${FLIP}, 0s` },
    transitionDelay: { default: "0s", [MOTION]: `0s, ${FLIP}` },
  },
  /* A wrapper because the lab reset's unlayered `button { color: inherit }` outranks the button's own colour. */
  coverInk: {
    display: "contents",
    color: COVER_INK,
  },
  wordmark: {
    fontSize: 15,
    fontWeight: 600,
    lineHeight: "20px",
    letterSpacing: "0.01em",
  },
  emblem: {
    display: "flex",
    marginBlock: "auto",
    opacity: 0.92,
  },
  coverTitle: {
    fontSize: 13,
    fontWeight: 500,
    lineHeight: "18px",
    opacity: 0.8,
  },
  coverName: {
    marginBlockStart: 2,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    opacity: 0.5,
  },
});
