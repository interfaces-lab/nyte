import { intent } from "@nyte-ai/ui/surface-theme";
import { glyph, shape } from "@nyte-ai/ui/schema.stylex";
/**
 * The two figures that carry the page's top-down reading: the layer stack,
 * and one message traced through it, each write shown as the `refs.update`
 * it publishes.
 */
import { create, props } from "@stylexjs/stylex";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import type { ReactNode } from "react";
import { Inline } from "./ui";

const styles = create({
  stack: {
    display: "flex",
    flexDirection: "column",
    marginInline: -12,
  },
  /* The glyph sits on the name's line, not the row's centre, when the role wraps. */
  layerPrimary: { alignItems: "flex-start" },
  layerLeading: { width: glyph.lg, height: type.leadingLg },
  layerTitle: { display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 },
  layerLabel: { fontWeight: 590 },
  layerRole: { whiteSpace: "normal", fontSize: type.fontBase, lineHeight: type.leadingBase },
  layerFiles: {
    display: { default: "inline", "@media (max-width: 700px)": "none" },
    flexShrink: 0,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
  },

  trace: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  step: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
  stepHead: { display: "flex", alignItems: "baseline", gap: 8 },
  stepNumber: {
    minWidth: "1.5ch",
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 500,
  },
  stepTitle: { margin: 0, fontSize: type.fontLg, lineHeight: type.leadingLg, fontWeight: 590 },

  cas: {
    paddingBlock: 8,
    paddingInline: 12,
    overflowX: "auto",
    borderRadius: shape.control,
    backgroundColor: role.bgMutedTranslucent,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: "20px",
  },
  casHead: { display: "flex", gap: 8, color: role.contentSecondary },
  reason: { color: role.contentSecondary },
  casNote: { marginInlineStart: "auto", color: role.contentSecondary, fontFamily: type.fontSans },
  casTable: { borderCollapse: "collapse", font: "inherit" },
  casRef: { width: 200, padding: 0, paddingInlineEnd: 16, whiteSpace: "nowrap" },
  casMove: { padding: 0, color: role.contentSecondary },
  assertion: { color: role.contentSecondary },
  arrow: { color: role.contentTertiary },
});

export interface Layer {
  readonly name: string;
  readonly icon: IconName;
  readonly files: string;
  readonly role: string;
  readonly href: string;
}

export function LayerStack(input: { readonly layers: readonly Layer[] }) {
  return (
    <nav aria-label="Core layers, top to bottom" {...props(styles.stack)}>
      {input.layers.map((layer) => (
        <Row key={layer.name} size="lg" interactive>
          <Row.Primary render={<a href={layer.href} />} xstyle={styles.layerPrimary}>
            <Row.Leading xstyle={styles.layerLeading}>
              <Icon name={layer.icon} size={16} />
            </Row.Leading>
            <Row.Body>
              <span {...props(styles.layerTitle)}>
                <Row.Label xstyle={styles.layerLabel}>{layer.name}</Row.Label>
                <span {...props(styles.layerFiles)}>{layer.files}</span>
              </span>
              <Row.Description xstyle={styles.layerRole}>
                <Inline text={layer.role} />
              </Row.Description>
            </Row.Body>
          </Row.Primary>
        </Row>
      ))}
    </nav>
  );
}

/** One ref in a CAS. `to` equal to `from` is an assertion and writes nothing. */
interface RefMove {
  readonly ref: string;
  readonly from: string;
  readonly to: string;
}

export function Cas(input: {
  readonly reason: string;
  readonly note?: string;
  readonly moves: readonly RefMove[];
}) {
  return (
    <div role="figure" aria-label={`refs.update, ${input.reason}`} {...props(styles.cas)}>
      <div {...props(styles.casHead)}>
        <span>refs.update</span>
        <span {...props([intent.success, styles.reason])}>"{input.reason}"</span>
        {input.note !== undefined && <span {...props(styles.casNote)}>{input.note}</span>}
      </div>
      <table {...props(styles.casTable)}>
        <tbody>
          {input.moves.map((move) => {
            const assertion = move.from === move.to;

            return (
              <tr key={move.ref} {...props(assertion && styles.assertion)}>
                <td {...props(styles.casRef)}>{move.ref}</td>
                <td {...props(styles.casMove, assertion && styles.assertion)}>
                  {move.from} <span {...props(styles.arrow)}>{assertion ? "=" : "→"}</span>{" "}
                  {move.to}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Trace(input: { readonly children: ReactNode }) {
  return <ol {...props(styles.trace)}>{input.children}</ol>;
}

export function TraceStep(input: {
  readonly number: number;
  readonly title: string;
  readonly where: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <li {...props(styles.step)}>
      <div {...props(styles.stepHead)}>
        <span aria-hidden {...props(styles.stepNumber)}>
          {input.number}
        </span>
        <h3 {...props(styles.stepTitle)}>{input.title}</h3>
        {input.where}
      </div>
      {input.children}
    </li>
  );
}
