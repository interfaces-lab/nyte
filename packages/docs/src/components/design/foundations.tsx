/**
 * Specimens for the design site's foundation pages. Each one renders the live
 * token through StyleX and prints the value from the source that declares it.
 */

import { platformColors, platformScopes } from "@nyte-ai/ui/platform-colors";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent, surfaceTheme, type Tint } from "@nyte-ai/ui/surface-theme";
import { create, props, when } from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { atDefaultSize, declaredToken, type DeclaredToken } from "~/lib/design-tokens";
import { motionRow } from "./markers.stylex";

type RoleName = keyof typeof platformColors.light;

const roleNames = Object.keys(platformColors.light).filter(
  (name): name is RoleName => name in platformColors.light,
);

const roleGroups = {
  content: (name: RoleName) => name.startsWith("content"),
  border: (name: RoleName) => name.startsWith("border"),
  surface: (name: RoleName) =>
    name.startsWith("bg") && !name.startsWith("bgInteractive") && !name.startsWith("bgControl"),
  interactive: (name: RoleName) => name.startsWith("bgInteractive") || name.startsWith("button"),
  control: (name: RoleName) => name.startsWith("bgControl"),
} as const;

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function Chip({ color, backdrop }: { color: string; backdrop: string }) {
  return (
    <span {...props(styles.chipBackdrop(backdrop))}>
      <span {...props(styles.chip(color))} />
    </span>
  );
}

function Value({ children }: { children: ReactNode }) {
  return <code {...props(styles.value)}>{children}</code>;
}

/** Every colour role in a group, as its light and dark values on their own page colour. */
export function RoleTable({ group }: { group: keyof typeof roleGroups }) {
  const rows = roleNames.filter(roleGroups[group]);
  return (
    <div className="doc-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Light</th>
            <th>Dark</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((name) => (
            <tr key={name}>
              <td>
                <code>role.{name}</code>
                <div {...props(styles.cssName)}>--nyte-{kebab(name)}</div>
              </td>
              {(["light", "dark"] as const).map((scheme) => (
                <td key={scheme}>
                  <span {...props(styles.chipRow)}>
                    <Chip
                      color={platformColors[scheme][name]}
                      backdrop={platformColors[scheme].bgBase}
                    />
                    <Value>{platformColors[scheme][name]}</Value>
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tints = Object.keys(surfaceTheme).filter((tint): tint is Tint => tint in surfaceTheme);

/** Each hue scope, live: the same four roles read differently inside it. */
export function HueScopes() {
  return (
    <div {...props(styles.scopeGrid)}>
      {tints.map((tint) => (
        <div key={tint} {...props(surfaceTheme[tint], styles.scope)}>
          <span {...props(styles.dot)} />
          <code {...props(styles.scopeName)}>{tint}</code>
          <span {...props(styles.scopePill)}>Label</span>
          <span {...props(styles.scopeFill)}>Action</span>
        </div>
      ))}
    </div>
  );
}

const intents = [
  { name: "primary", hue: "blue", use: "Filled actions, links, the current item" },
  { name: "success", hue: "green", use: "Status text: done, passing" },
  { name: "warning", hue: "yellow", use: "Status text: needs attention" },
  { name: "danger", hue: "red", use: "Status text, destructive menu items and alert actions" },
] as const;

/** Intents name a hue by meaning. */
export function IntentTable() {
  return (
    <div className="doc-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Intent</th>
            <th>Hue</th>
            <th>Text</th>
            <th>Use</th>
          </tr>
        </thead>
        <tbody>
          {intents.map(({ name, hue, use }) => (
            <tr key={name}>
              <td>
                <code>intent.{name}</code>
              </td>
              <td>
                <code>{hue}</code>
              </td>
              <td>
                <span {...props(intent[name], styles.intentText)}>
                  {platformScopes.light[hue].contentSecondary}
                </span>
              </td>
              <td>{use}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fine({ token }: { token: DeclaredToken }) {
  return (
    <>
      <Value>{token.value}</Value>
      {token.coarse ? (
        <span {...props(styles.coarse)}>
          {" "}
          · touch <Value>{token.coarse}</Value>
        </span>
      ) : null}
    </>
  );
}

const radii = [
  {
    handle: "radius.indicator",
    token: "--nyte-shape-indicator",
    value: radius.indicator,
    use: "Keycaps, meters, small buttons",
  },
  {
    handle: "radius.control",
    token: "--nyte-shape-control",
    value: radius.control,
    use: "Menu items, autocomplete rows, chart tooltips",
  },
  {
    handle: "radius.card",
    token: "--nyte-shape-card",
    value: radius.card,
    use: "Popovers, the command palette",
  },
  {
    handle: "radius.surface",
    token: "--nyte-shape-surface",
    value: radius.surface,
    use: "Floating surfaces, toasts",
  },
  {
    handle: "radius.pill",
    token: "--nyte-shape-pill",
    value: radius.pill,
    use: "Avatars, checkboxes, pill buttons",
  },
] as const;

export function RadiusScale() {
  return (
    <div {...props(styles.specimenGrid)}>
      {radii.map((item) => (
        <figure key={item.handle} {...props(styles.specimen)}>
          <div {...props(styles.radiusBox(item.value))} />
          <figcaption {...props(styles.caption)}>
            <code>{item.handle}</code>
            <Fine token={declaredToken(item.token)} />
            <span {...props(styles.use)}>{item.use}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

const componentRadii = [
  ["Button 2xs", "--nyte-btn-radius-2xs"],
  ["Button xs", "--nyte-btn-radius-xs"],
  ["Button sm", "--nyte-btn-radius-sm"],
  ["Button md", "--nyte-btn-radius-md"],
  ["Button lg", "--nyte-btn-radius-lg"],
  ["Button xl", "--nyte-btn-radius-xl"],
  ["Input md", "--nyte-input-radius-md"],
  ["Input lg", "--nyte-input-radius-lg"],
  ["Input xl", "--nyte-input-radius-xl"],
  ["Checkbox", "--nyte-checkbox-radius"],
  ["Row", "--nyte-row-radius"],
  ["Menu item", "--nyte-menu-item-radius"],
  ["Menu", "--nyte-menu-radius"],
  ["Dialog", "--nyte-dialog-radius"],
] as const;

export function ComponentRadii() {
  return <TokenRows rows={componentRadii} />;
}

export function TargetRows() {
  return (
    <TokenRows
      rows={[
        ["Minimum hit area", "--nyte-target-min"],
        ["Gap between controls", "--nyte-target-gap"],
      ]}
    />
  );
}

function TokenRows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <div className="doc-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Part</th>
            <th>Token</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, name]) => (
            <tr key={name}>
              <td>{label}</td>
              <td>
                <code>{name}</code>
              </td>
              <td>
                <Fine token={declaredToken(name)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const spaces = [
  ["px", space.px, "1px"],
  ["s0_5", space.s0_5, "0.5"],
  ["s1", space.s1, "1"],
  ["s1_5", space.s1_5, "1.5"],
  ["s2", space.s2, "2"],
  ["s2_5", space.s2_5, "2.5"],
  ["s3", space.s3, "3"],
  ["s4", space.s4, "4"],
  ["s5", space.s5, "5"],
  ["s6", space.s6, "6"],
  ["s8", space.s8, "8"],
] as const;

export function SpaceScale() {
  const unit = Number.parseFloat(declaredToken("--nyte-space-unit").value);
  return (
    <div className="doc-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Handle</th>
            <th>Units</th>
            <th>Value</th>
            <th aria-label="Specimen" />
          </tr>
        </thead>
        <tbody>
          {spaces.map(([name, value, units]) => (
            <tr key={name}>
              <td>
                <code>space.{name}</code>
              </td>
              <td>{units === "1px" ? "hairline" : `× ${units}`}</td>
              <td>
                <Value>{units === "1px" ? "1px" : `${Number(units) * unit}px`}</Value>
              </td>
              <td>
                <span {...props(styles.spaceBar(value))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const textStyles = [
  {
    name: "xs",
    style: text.xs,
    size: "--nyte-font-size-xs",
    leading: "--nyte-line-height-xs",
    tracking: "--nyte-letter-spacing-base",
    use: "Tooltips, chart labels, composer chips",
  },
  {
    name: "sm",
    style: text.sm,
    size: "--nyte-font-size-sm",
    leading: "--nyte-line-height-sm",
    tracking: "--nyte-letter-spacing-base",
    use: "Small buttons, field hints, sidebars",
  },
  {
    name: "baseCompact",
    style: text.baseCompact,
    size: "--nyte-font-size-base",
    leading: "--nyte-line-height-sm",
    tracking: "--nyte-letter-spacing-base",
    use: "A one-line 13px label; the floor for 13px Inter",
  },
  {
    name: "base",
    style: text.base,
    size: "--nyte-font-size-base",
    leading: "--nyte-line-height-base",
    tracking: "--nyte-letter-spacing-base",
    use: "Body text, controls, dialogs",
  },
  {
    name: "lg",
    style: text.lg,
    size: "--nyte-font-size-lg",
    leading: "--nyte-line-height-lg",
    tracking: "--nyte-letter-spacing-lg",
    use: "Dialog titles, the transcript",
  },
  {
    name: "code",
    style: text.code,
    size: "--nyte-font-size-code",
    leading: "--nyte-line-height-code",
    tracking: undefined,
    use: "Code blocks, diffs, tool calls",
  },
] as const;

export function TypeScale() {
  return (
    <div {...props(styles.typeList)}>
      {textStyles.map((item) => (
        <div key={item.name} {...props(styles.typeRow)}>
          <p {...props(item.style, styles.typeSample)}>Every session is a tree of commits</p>
          <div {...props(styles.typeMeta)}>
            <code>text.{item.name}</code>
            <Value>
              {atDefaultSize(declaredToken(item.size).value)} /{" "}
              {atDefaultSize(declaredToken(item.leading).value)}
              {item.tracking ? ` · ${declaredToken(item.tracking).value}` : ""}
            </Value>
            <span {...props(styles.use)}>{item.use}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const weights = [
  { name: "weightRegular", token: "--nyte-font-weight-regular", style: type.weightRegular },
  { name: "weightMedium", token: "--nyte-font-weight-medium", style: type.weightMedium },
  { name: "weightSemibold", token: "--nyte-font-weight-semibold", style: type.weightSemibold },
] as const;

export function TypeWeights() {
  return (
    <div {...props(styles.typeList)}>
      {weights.map((item) => (
        <div key={item.name} {...props(styles.typeRow)}>
          <p {...props(text.lg, styles.weight(item.style))}>Agent core</p>
          <div {...props(styles.typeMeta)}>
            <code>type.{item.name}</code>
            <Value>{declaredToken(item.token).value}</Value>
          </div>
        </div>
      ))}
    </div>
  );
}

const shadows = [
  {
    handle: "shadow.shadowSm",
    token: "--nyte-shadow-sm",
    value: shadow.shadowSm,
    use: "Buttons, switches, slider thumbs, tabs",
  },
  {
    handle: "shadow.shadowMdOutline",
    token: "--nyte-shadow-md-outline",
    value: shadow.shadowMdOutline,
    use: "Tooltips, toasts: a drop plus a hairline",
  },
  {
    handle: "shadow.shadowLg",
    token: "--nyte-shadow-lg",
    value: shadow.shadowLg,
    use: "Floating surfaces, select popups",
  },
  { handle: "shadow.shadowXl", token: "--nyte-shadow-xl", value: shadow.shadowXl, use: "Dialogs" },
] as const;

export function ShadowScale() {
  return (
    <div {...props(styles.specimenGrid)}>
      {shadows.map((item) => (
        <figure key={item.handle} {...props(styles.specimen)}>
          <div {...props(styles.shadowBox(item.value))} />
          <figcaption {...props(styles.caption)}>
            <code>{item.handle}</code>
            <span {...props(styles.use)}>{item.use}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

const durations = [
  {
    handle: "durationInstant",
    token: "--nyte-duration-instant",
    value: motion.durationInstant,
    use: "Kbd and menu press feedback",
  },
  {
    handle: "durationFast",
    token: "--nyte-duration-fast",
    value: motion.durationFast,
    use: "Buttons, menus, popovers, meters",
  },
  {
    handle: "durationNormal",
    token: "--nyte-duration-normal",
    value: motion.durationNormal,
    use: "Collapsibles, toasts, the sidebar",
  },
  {
    handle: "durationSlow",
    token: "--nyte-duration-slow",
    value: motion.durationSlow,
    use: "Switches, the sidebar",
  },
] as const;

const easings = [
  {
    handle: "easeOut",
    token: "--nyte-easing-out",
    value: motion.easeOut,
    use: "Buttons, menus, popovers, rows",
  },
  {
    handle: "easeOutQuint",
    token: "--nyte-easing-out-quint",
    value: motion.easeOutQuint,
    use: "Menus, select, the command palette",
  },
  {
    handle: "easeInOutStrong",
    token: "--nyte-easing-in-out-strong",
    value: motion.easeInOutStrong,
    use: "The switch knob",
  },
] as const;

/** Hover a row to run the curve; reduced motion skips the travel. */
export function MotionScale() {
  return (
    <div className="doc-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Handle</th>
            <th>Value</th>
            <th>Used by</th>
            <th aria-label="Specimen" />
          </tr>
        </thead>
        <tbody>
          {durations.map((item) => (
            <tr key={item.handle} {...props(motionRow)}>
              <td>
                <code>motion.{item.handle}</code>
              </td>
              <td>
                <Value>{declaredToken(item.token).value}</Value>
              </td>
              <td>{item.use}</td>
              <td>
                <span {...props(styles.track)}>
                  <span {...props(styles.puck(item.value, motion.easeOut))} />
                </span>
              </td>
            </tr>
          ))}
          {easings.map((item) => (
            <tr key={item.handle} {...props(motionRow)}>
              <td>
                <code>motion.{item.handle}</code>
              </td>
              <td>
                <Value>{declaredToken(item.token).value}</Value>
              </td>
              <td>{item.use}</td>
              <td>
                <span {...props(styles.track)}>
                  <span {...props(styles.puck(motion.durationSlow, item.value))} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles = create({
  value: {
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    color: role.contentSecondary,
    whiteSpace: "nowrap",
  },
  cssName: {
    marginBlockStart: space.s0_5,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    color: role.contentTertiary,
  },
  coarse: {
    color: role.contentTertiary,
    whiteSpace: "nowrap",
  },
  chipRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
  },
  chipBackdrop: (backdrop: string) => ({
    display: "inline-flex",
    padding: space.s1,
    borderRadius: radius.control,
    backgroundColor: backdrop,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  }),
  chip: (color: string) => ({
    display: "block",
    width: space.s6,
    height: space.s4,
    borderRadius: radius.indicator,
    backgroundColor: color,
  }),
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: space.s2,
    marginBlock: space.s4,
  },
  scope: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    padding: space.s2,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
  },
  dot: {
    width: space.s2,
    height: space.s2,
    flexShrink: 0,
    borderRadius: radius.pill,
    backgroundColor: role.contentInteractiveTertiary,
  },
  scopeName: {
    flexGrow: 1,
    color: role.contentSecondary,
  },
  scopePill: {
    paddingInline: space.s2,
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    color: role.contentInteractivePrimary,
    fontSize: type.fontSm,
    lineHeight: type.leadingBase,
  },
  scopeFill: {
    paddingInline: space.s2,
    borderRadius: radius.control,
    backgroundColor: role.buttonFill,
    color: role.contentOnInteractiveStrong,
    fontSize: type.fontSm,
    lineHeight: type.leadingBase,
  },
  intentText: {
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    color: role.contentSecondary,
  },
  specimenGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: space.s6,
    marginBlock: space.s6,
  },
  specimen: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    margin: 0,
  },
  caption: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s1,
  },
  use: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  radiusBox: (value: string) => ({
    height: 96,
    borderStartStartRadius: value,
    borderStartEndRadius: value,
    borderEndStartRadius: value,
    borderEndEndRadius: value,
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderPrimaryTranslucent}`,
  }),
  shadowBox: (value: string) => ({
    height: 96,
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    boxShadow: value,
  }),
  spaceBar: (value: string) => ({
    display: "block",
    width: value,
    height: space.s3,
    borderRadius: 1,
    backgroundColor: role.contentInteractiveTertiary,
  }),
  typeList: {
    display: "flex",
    flexDirection: "column",
    marginBlock: space.s4,
  },
  typeRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 220px",
    alignItems: "baseline",
    gap: space.s4,
    paddingBlock: space.s3,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: role.borderSecondaryTranslucent,
  },
  typeSample: {
    margin: 0,
    color: role.contentPrimary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  typeMeta: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s0_5,
  },
  weight: (fontWeight: string) => ({ margin: 0, fontWeight }),
  track: {
    display: "block",
    position: "relative",
    width: 64,
    height: space.s2,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
  },
  puck: (duration: string, easing: string) => ({
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: 0,
    width: space.s4,
    borderRadius: radius.pill,
    backgroundColor: role.contentInteractiveTertiary,
    transform: {
      default: null,
      [when.ancestor(":hover", motionRow)]: {
        default: null,
        "@media (hover: hover) and (pointer: fine)": "translateX(48px)",
      },
    },
    transitionProperty: "transform",
    transitionDuration: { default: duration, "@media (prefers-reduced-motion: reduce)": "0s" },
    transitionTimingFunction: easing,
  }),
});
