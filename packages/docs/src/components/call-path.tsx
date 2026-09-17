import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { colorVars, motionVars } from "@nyte-ai/ui/platform-tokens.stylex";

/*
 * Built rows link to the design section that covers them. The last connector is
 * dashed because @nyte-ai/protocol is named and not built. Accent means built.
 * Reserved rows stay muted, with a hollow marker.
 */

interface Stage {
  name: string;
  note: string;
  href?: string;
  built: boolean;
  /** The connector drawn beneath this row. */
  hop?: "solid" | "dashed";
}

const stages: Stage[] = [
  {
    name: "client",
    note: "tui (OpenTUI) · desktop (Electron)",
    href: "/docs/design#deployment",
    built: true,
    hop: "solid",
  },
  {
    name: "step",
    note: "one durable step under a fenced lease; drive loops it",
    href: "/docs/design#leases-and-the-step",
    built: true,
    hop: "solid",
  },
  {
    name: "turn",
    note: "respond, then the tool batch; the step commits between",
    href: "/docs/design#the-turn",
    built: true,
    hop: "solid",
  },
  {
    name: "StreamFn",
    note: "one injected function; the loop knows no provider",
    href: "/docs/design#the-sdk",
    built: true,
    hop: "solid",
  },
  {
    name: "@nyte-ai/ai",
    note: "credential store, OAuth, streamed Responses client",
    built: true,
    hop: "dashed",
  },
  {
    name: "@nyte-ai/protocol",
    note: "the wire a browser client would attach to. Reserved, not built",
    built: false,
  },
];

const styles = stylex.create({
  hop: {
    borderLeftColor: colorVars["--nyte-color-border"],
  },
  hopDashed: {
    borderLeftStyle: "dashed",
  },
  markerBuilt: {
    backgroundColor: colorVars["--nyte-color-accent"],
  },
  markerReserved: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-muted-foreground"],
    backgroundColor: colorVars["--nyte-color-background"],
  },
  nameBuilt: {
    color: colorVars["--nyte-color-foreground"],
    textDecorationLine: "underline",
    textDecorationColor: {
      default: "transparent",
      ":hover": colorVars["--nyte-color-accent"],
    },
    textDecorationThickness: "1px",
    textUnderlineOffset: "4px",
    transitionProperty: "text-decoration-color",
    transitionDuration: motionVars["--nyte-motion-fast"],
  },
  nameReserved: {
    color: colorVars["--nyte-color-muted-foreground"],
  },
  note: {
    color: colorVars["--nyte-color-muted-foreground"],
  },
  leader: {
    borderBottomColor: colorVars["--nyte-color-border"],
  },
});

function withStylex(className: string, props: ReturnType<typeof stylex.props>) {
  return {
    className: [className, props.className].filter(Boolean).join(" "),
    style: props.style,
  };
}

export function CallPath() {
  return (
    <ol className="nyte-mono max-w-184 text-[13px] leading-none">
      {stages.map((stage, index) => (
        <li key={stage.name} className="relative pl-7">
          {stage.hop ? (
            <span
              aria-hidden
              {...withStylex(
                "absolute top-[14px] bottom-0 left-[5px] w-0 border-l",
                stylex.props(styles.hop, stage.hop === "dashed" && styles.hopDashed),
              )}
            />
          ) : null}

          <span
            aria-hidden
            {...withStylex(
              "absolute top-[9px] left-[2px] size-1.5",
              stylex.props(stage.built ? styles.markerBuilt : styles.markerReserved),
            )}
          />

          <StageRow stage={stage} isLast={index === stages.length - 1} />
        </li>
      ))}
    </ol>
  );
}

function StageRow({ stage, isLast }: { stage: Stage; isLast: boolean }) {
  const padding = isLast ? "block py-2.5" : "block py-2.5 pb-7";

  const body = (
    <>
      <span className="flex items-baseline gap-3">
        <span
          {...withStylex(
            "shrink-0",
            stylex.props(stage.built ? styles.nameBuilt : styles.nameReserved),
          )}
        >
          {stage.name}
        </span>
        <span
          aria-hidden
          {...withStylex(
            "min-w-6 flex-1 translate-y-[-3px] border-b border-dotted",
            stylex.props(styles.leader),
          )}
        />
        <span {...withStylex("hidden shrink-0 sm:inline", stylex.props(styles.note))}>
          {stage.note}
        </span>
      </span>
      <span {...withStylex("mt-2 block sm:hidden", stylex.props(styles.note))}>{stage.note}</span>
    </>
  );

  if (!stage.href) return <div className={padding}>{body}</div>;

  return (
    <Link href={stage.href} className={padding}>
      {body}
    </Link>
  );
}
