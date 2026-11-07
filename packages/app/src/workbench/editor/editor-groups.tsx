import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { DragEvent, ReactElement, ReactNode } from "react";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { appearance, role } from "@nyte-ai/ui/styles/vars.stylex";
import type { WorkbenchViewKey } from "../model.ts";
import { workbench } from "../store.ts";
import { carriesEditorDrop, readEditorDrop } from "./editor-drop.ts";
import { fileActions } from "./file-store.ts";
import type { FileGroup } from "./file-store.ts";

type Zone = "before" | "center" | "after";

export function EditorGroupView(input: {
  readonly viewKey: WorkbenchViewKey;
  readonly group: FileGroup;
  readonly index: number;
  readonly many: boolean;
  readonly focused: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const [zone, setZone] = useState<Zone>();

  return (
    <section
      aria-label={`Editor group ${String(input.index + 1)}`}
      data-focused={input.focused ? "" : undefined}
      {...props(styles.group, input.many && input.index > 0 && hairline.inlineStart)}
      onPointerDownCapture={() => {
        if (!input.focused) fileActions.focusGroup(input.viewKey, input.group.id);
      }}
      onFocusCapture={() => {
        if (!input.focused) fileActions.focusGroup(input.viewKey, input.group.id);
      }}
      onDragOver={(event) => {
        if (!carriesEditorDrop(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setZone(dropZone(event));
      }}
      onDragLeave={(event) => {
        if (
          !event.currentTarget.contains(
            event.relatedTarget instanceof Node ? event.relatedTarget : null,
          )
        )
          setZone(undefined);
      }}
      onDrop={(event) => {
        setZone(undefined);
        const source = readEditorDrop(event);

        if (source === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        fileActions.place(input.viewKey, source, {
          kind: "body",
          group: input.group.id,
          zone: dropZone(event),
        });
        const active = workbench.getView(input.viewKey).active;

        if (active === null) return;
        requestAnimationFrame(() =>
          document.getElementById(`${input.viewKey}-file-tab-${active}`)?.focus(),
        );
      }}
    >
      {input.children}
      {zone !== undefined && <div aria-hidden="true" {...props(styles.drop, styles[zone])} />}
    </section>
  );
}

function dropZone(event: DragEvent<HTMLElement>): Zone {
  const rect = event.currentTarget.getBoundingClientRect();
  const at = (event.clientX - rect.left) / rect.width;
  const start = getComputedStyle(event.currentTarget).direction === "rtl" ? "after" : "before";
  const end = start === "before" ? "after" : "before";

  return at < 0.25 ? start : at > 0.75 ? end : "center";
}

const styles = create({
  group: { position: "relative", display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  drop: {
    position: "absolute",
    insetBlock: 0,
    zIndex: 3,
    pointerEvents: "none",
    backgroundColor: role.bgMutedTranslucent,
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineOffset: -2,
    outlineColor: appearance.focusColor,
    borderRadius: radius.control,
  },
  before: { insetInlineStart: 0, width: "50%" },
  center: { insetInline: 0 },
  after: { insetInlineEnd: 0, width: "50%" },
});
