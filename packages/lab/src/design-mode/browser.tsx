import { create, props } from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { button, input, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { findElements } from "./picker";
import type { Target } from "./picker";
import { design } from "./design.stylex";
import { DesignLayer } from "./layer";
import type { Draft, Placement, QueuedComment } from "./layer";
import { OrbitSite } from "./site";

const DEVICES = [
  { value: "responsive", label: "Responsive", width: 412, height: 915 },
  { value: "iphone-17", label: "iPhone 17", width: 402, height: 874 },
  { value: "pixel-10", label: "Pixel 10", width: 412, height: 923 },
  { value: "ipad-mini", label: "iPad mini", width: 744, height: 1133 },
  { value: "laptop", label: "Laptop", width: 1366, height: 768 },
] as const;

type DeviceId = (typeof DEVICES)[number]["value"];

const STAGE_PADDING = 24;

interface Stage {
  readonly width: number;
  readonly height: number;
}

export function BrowserPanel({
  rootRef,
  active,
  onActiveChange,
  placement,
  comments,
  onSave,
  onRemove,
  onAttach,
}: {
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly active: boolean;
  readonly onActiveChange: (active: boolean) => void;
  readonly placement: Placement;
  readonly comments: readonly QueuedComment[];
  readonly onSave: (draft: Draft) => void;
  readonly onRemove: (id: number) => void;
  readonly onAttach: (target: Target) => void;
}): ReactElement {
  const [draft, setDraft] = useState<Draft>();
  const [responsive, setResponsive] = useState(false);
  const [device, setDevice] = useState<DeviceId>("responsive");
  const [rotated, setRotated] = useState(false);
  const [fit, setFit] = useState(true);
  const [xray, setXray] = useState(false);
  const [stage, setStage] = useState<Stage>();
  const [visit, setVisit] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const missing = useMissingCount(scrollerRef, rootRef, comments);
  const preset = DEVICES.find((entry) => entry.value === device) ?? DEVICES[0];
  const width = rotated ? preset.height : preset.width;
  const height = rotated ? preset.width : preset.height;

  const scale =
    fit && stage !== undefined
      ? Math.min(
          1,
          (stage.width - STAGE_PADDING * 2) / width,
          (stage.height - STAGE_PADDING * 2) / height,
        )
      : 1;

  const setActive = (next: boolean): void => {
    if (!next) setDraft(undefined);
    onActiveChange(next);
  };

  // oxlint-disable-next-line nyte-code/no-direct-effect -- Fit follows the stage's size
  useEffect(() => {
    const element = stageRef.current;

    if (element === null) return;

    const observer = new ResizeObserver(() =>
      setStage({ width: element.clientWidth, height: element.clientHeight }),
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- ⌘⇧L toggles Design Mode wherever focus is
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "l" || !event.shiftKey || !(event.metaKey || event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      setActive(!active);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  });

  const viewport = (
    <div ref={viewportRef} {...props(styles.viewport)}>
      <div ref={scrollerRef} {...props(styles.scroller)}>
        <OrbitSite key={visit} rootRef={rootRef} />
      </div>
      {active && (
        <DesignLayer
          key={visit}
          viewportRef={viewportRef}
          scrollerRef={scrollerRef}
          rootRef={rootRef}
          placement={placement}
          xray={xray}
          draft={draft}
          comments={comments}
          onDraftChange={setDraft}
          onSave={(saved) => {
            onSave(saved);
            setDraft(undefined);
          }}
          onRemove={onRemove}
          onAttach={onAttach}
          onExit={() => setActive(false)}
        />
      )}
    </div>
  );

  return (
    <section aria-label="Browser" {...props(styles.panel)}>
      <div {...props(styles.toolbar)}>
        <Button iconOnly size="sm" icon="arrow-left" aria-label="Go Back" disabled />
        <Button iconOnly size="sm" icon="arrow-right" aria-label="Go Forward" disabled />
        <Button
          iconOnly
          size="sm"
          icon="refresh"
          aria-label="Reload Page"
          onClick={() => setVisit(visit + 1)}
        />
        <div {...props(styles.address)}>
          <Icon name="lock" size={12} />
          <span {...props(styles.addressText)}>orbit.dev/docs</span>
        </div>
        <Toggle
          iconOnly
          size="sm"
          icon="bezier-pointer"
          aria-label="Design Mode"
          aria-keyshortcuts="Meta+Shift+L"
          title="Design Mode (⌘⇧L): point at anything and tell the agent what to change"
          pressed={active}
          onPressedChange={setActive}
        />
        <Toggle
          iconOnly
          size="sm"
          icon="devices"
          aria-label="Responsive Mode"
          pressed={responsive}
          onPressedChange={setResponsive}
        />
        <Button iconOnly size="sm" icon="more-horizontal" aria-label="Browser Actions" disabled />
      </div>

      {active && (
        <HintRow
          draft={draft}
          comments={comments.length}
          missing={missing}
          xray={xray}
          onXrayChange={setXray}
          onExit={() => setActive(false)}
        />
      )}

      {responsive && (
        <div {...props(styles.deviceBar)}>
          <Select
            items={DEVICES}
            value={device}
            onValueChange={(next) => {
              const chosen = DEVICES.find((entry) => entry.value === next);

              if (chosen !== undefined) setDevice(chosen.value);
            }}
          >
            <SelectTrigger aria-label="Device">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {DEVICES.map((entry) => (
                <SelectItem key={entry.value} value={entry.value} label={entry.label}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span {...props(styles.dimensions)}>
            {width} × {height} · {Math.round(scale * 100)}%
          </span>
          <Button
            iconOnly
            size="sm"
            icon="refresh"
            aria-label="Rotate"
            onClick={() => setRotated(!rotated)}
          />
          <ToggleGroup
            aria-label="Zoom"
            value={[fit ? "fit" : "actual"]}
            onValueChange={(values) => {
              const next = values.at(-1);

              if (next !== undefined) setFit(next === "fit");
            }}
          >
            <Toggle value="fit" size="sm">
              Fit
            </Toggle>
            <Toggle value="actual" size="sm">
              100%
            </Toggle>
          </ToggleGroup>
        </div>
      )}

      <div ref={stageRef} {...props(styles.stage, responsive && styles.stageDevice)}>
        {responsive ? (
          <div {...props(styles.sizer)} style={{ width: width * scale, height: height * scale }}>
            <div
              {...props(styles.device)}
              style={{ width, height, transform: `scale(${String(scale)})` }}
            >
              {viewport}
            </div>
          </div>
        ) : (
          viewport
        )}
      </div>

      {active && <div aria-hidden="true" {...props(styles.ring)} />}
    </section>
  );
}

function HintRow({
  draft,
  comments,
  missing,
  xray,
  onXrayChange,
  onExit,
}: {
  readonly draft: Draft | undefined;
  readonly comments: number;
  readonly missing: number;
  readonly xray: boolean;
  readonly onXrayChange: (xray: boolean) => void;
  readonly onExit: () => void;
}): ReactElement {
  return (
    <div {...props(styles.hint)}>
      <Button iconOnly size="sm" icon="x" aria-label="Exit Design Mode" onClick={onExit} />
      <span role="status" {...props(styles.hintText)}>
        {hint(draft)}
      </span>
      {comments > 0 && (
        <span {...props(styles.trayCount)}>
          {comments} in chat
          {missing > 0 && <span {...props(styles.missing)}> · {missing} not found</span>}
        </span>
      )}
      <Toggle
        size="sm"
        icon="eye"
        title="X-ray: outline every element, and what a drag would cover"
        pressed={xray}
        onPressedChange={onXrayChange}
      >
        X-ray
      </Toggle>
    </div>
  );
}

/**
 * How many queued element comments have lost every element, rechecked whenever the page's DOM
 * changes: a reload swaps every node, and a closed banner takes its buttons with it.
 */
function useMissingCount(
  scrollerRef: RefObject<HTMLDivElement | null>,
  rootRef: RefObject<HTMLDivElement | null>,
  comments: readonly QueuedComment[],
): number {
  const [missing, setMissing] = useState(0);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- follows the page's DOM, which React doesn't own after a reload
  useEffect(() => {
    const scroller = scrollerRef.current;

    if (scroller === null) return;

    const count = (): void => {
      const root = rootRef.current;

      setMissing(
        root === null
          ? 0
          : comments.filter((comment) => findElements(comment.target, root) === undefined).length,
      );
    };

    count();
    const observer = new MutationObserver(count);

    observer.observe(scroller, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [scrollerRef, rootRef, comments]);

  return missing;
}

function hint(draft: Draft | undefined): ReactNode {
  if (draft === undefined) {
    return (
      <>
        <b>Click</b> to select or <b>drag</b> to create an area · <b>↑↓</b> to adjust · <b>Esc</b>{" "}
        to exit
      </>
    );
  }

  return (
    <>
      <b>Return</b> to add to the chat
      {draft.target.kind === "element" && (
        <>
          {" "}
          · <b>Shift-click</b> to add elements
        </>
      )}{" "}
      · <b>Esc</b> to cancel
    </>
  );
}

const styles = create({
  panel: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    height: 40,
    paddingInline: 6,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: `${role.borderSecondaryTranslucent}`,
  },
  address: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
    height: input.heightMd,
    paddingInline: 10,
    borderRadius: radius.control,
    backgroundColor: role.bgMuted,
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
  addressText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  hint: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    minHeight: button.heightXl,
    paddingInline: 6,
    backgroundColor: `color-mix(in srgb, ${design.accent} 10%, ${role.bgBase})`,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: `color-mix(in srgb, ${design.accent} 18%, transparent)`,
    color: `color-mix(in srgb, ${design.accent} 80%, ${role.contentPrimary})`,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  hintText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  trayCount: { flexShrink: 0, paddingInline: 6, fontWeight: type.weightMedium },
  missing: { color: role.contentSecondary, fontWeight: type.weightRegular },
  deviceBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    height: 40,
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: `${role.borderSecondaryTranslucent}`,
    fontSize: type.fontSm,
  },
  dimensions: {
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  spacer: { flex: 1 },
  stage: { position: "relative", flex: 1, minHeight: 0, overflow: "hidden" },
  stageDevice: {
    display: "grid",
    placeItems: "start safe center",
    padding: STAGE_PADDING,
    overflow: "auto",
    backgroundColor: role.bgMuted,
  },
  sizer: { position: "relative", flexShrink: 0 },
  device: {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineStart: 0,
    transformOrigin: "0 0",
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}, 0 8px 24px rgb(0 0 0 / 0.12)`,
  },
  viewport: { position: "relative", width: "100%", height: "100%", overflow: "hidden" },
  scroller: { position: "absolute", inset: 0, overflow: "auto" },
  ring: {
    position: "absolute",
    inset: 0,
    zIndex: 2,
    pointerEvents: "none",
    borderRadius: "inherit",
    boxShadow: `inset 0 0 0 2px ${design.accent}`,
  },
});
