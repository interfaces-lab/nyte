import { create, props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { canvas } from "@nyte-ai/plugin/canvas/schema";
import type { CanvasRevision, CanvasState } from "@nyte-ai/plugin/canvas/schema";
import type { BlobId, PartId, SessionId } from "@nyte-ai/sdk";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Toggle } from "@nyte-ai/ui/toggle";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { formatTimeAgo } from "../components/ui.tsx";
import { CanvasFrame } from "../conversation/canvas-frame.tsx";
import { connection, partWatch, useWatch } from "../sdk.tsx";
import { useCanvasEditing } from "./canvas-activity.ts";
import { useNowMinute } from "../use-now-minute.ts";
import { workbenchStyles } from "./workbench.stylex.ts";

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: role.bgBase,
  },
  toolbar: { gap: space.s2, paddingInlineStart: space.s3 },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: role.contentPrimary,
  },
  editing: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    flexShrink: 0,
    color: role.contentSecondary,
  },
  body: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  column: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    overflowY: "auto",
    paddingInline: space.s3,
  },
  divided: {
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.borderSecondaryTranslucent,
  },
  heading: { margin: 0, paddingBlockStart: space.s2, color: role.contentSecondary },
  message: { margin: 0, padding: space.s4, color: role.contentSecondary },
});

const LATEST = "latest";

export function CanvasPanel({
  sessionId,
  part,
  pinned,
  onPin,
}: {
  readonly sessionId: SessionId;
  readonly part: PartId;
  readonly pinned: number | null;
  readonly onPin: (revision: number | null) => void;
}): ReactElement {
  const watched = useWatch(partWatch(sessionId, part));
  const editing = useCanvasEditing(sessionId, part);
  const now = useNowMinute();
  const view = watched.value;

  if (view === undefined)
    return (
      <section aria-label="Canvas" {...props(styles.panel)}>
        {watched.error !== undefined && (
          <p {...props(text.base, styles.message)}>{watched.error.message}</p>
        )}
      </section>
    );

  const checked = view === null ? undefined : canvas.state["~standard"].validate(view.state);

  const state =
    checked === undefined || checked instanceof Promise || checked.issues !== undefined
      ? undefined
      : checked.value;

  if (state === undefined)
    return (
      <section aria-label="Canvas" {...props(styles.panel)}>
        <p {...props(text.base, styles.message)}>
          {view === null ? "This canvas is no longer in its chat." : "This canvas can't be shown."}
        </p>
      </section>
    );

  const revisions = state.revisions ?? [];
  const latest = revisions.at(-1)?.number ?? 1;
  const held = pinned === latest ? undefined : revisions.find((entry) => entry.number === pinned);

  const choices = [
    { value: LATEST, label: `r${String(latest)} (latest)` },
    ...revisions
      .slice(0, -1)
      .toReversed()
      .map((entry) => ({
        value: String(entry.number),
        label: `r${String(entry.number)} · ${formatTimeAgo(entry.at, now)}`,
      })),
  ];

  return (
    <section aria-label={state.title} {...props(styles.panel)}>
      <div {...props(workbenchStyles.toolbar, styles.toolbar)}>
        <span {...props(text.base, styles.title)}>{state.title}</span>
        {editing && (
          <span role="status" {...props(text.sm, styles.editing)}>
            <Spinner />
            Updating
          </span>
        )}
        {revisions.length > 1 && (
          <Select
            items={choices}
            value={held === undefined ? LATEST : String(held.number)}
            onValueChange={(next) => {
              if (next !== null) onPin(next === LATEST ? null : Number(next));
            }}
          >
            <SelectTrigger aria-label="Revision beside the latest">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value} label={choice.label}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Toggle
          iconOnly
          icon="pin"
          aria-label={pinned === null ? `Pin r${String(latest)}` : "Unpin revision"}
          pressed={pinned !== null}
          onPressedChange={(pressed) => onPin(pressed ? latest : null)}
        />
      </div>
      <div {...props(styles.body)}>
        {held !== undefined && <PinnedRevision key={held.number} revision={held} />}
        <div {...props(styles.column, held !== undefined && styles.divided)}>
          {held !== undefined && <p {...props(text.sm, styles.heading)}>r{latest} · latest</p>}
          <CanvasFrame
            state={state}
            report={(message) =>
              void connection().session(sessionId).part(part).act("report", { message })
            }
          />
        </div>
      </div>
    </section>
  );
}

function PinnedRevision({ revision }: { readonly revision: CanvasRevision }): ReactElement {
  const code = useQuery({
    queryKey: ["canvas-revision", revision.blob],
    queryFn: () => readCode(revision.blob),
    staleTime: Number.POSITIVE_INFINITY,
  });

  return (
    <div {...props(styles.column)}>
      <p {...props(text.sm, styles.heading)}>r{revision.number} · pinned</p>
      {code.data !== undefined && (
        <CanvasFrame state={{ ...revision, code: code.data, error: null }} />
      )}
      {code.error !== null && <p {...props(text.base, styles.message)}>{code.error.message}</p>}
    </div>
  );
}

/** Reads a revision's compiled module from the blob its render stored. */
async function readCode(blob: BlobId): Promise<CanvasState["code"]> {
  const reader = await connection().blob(blob);
  const decoder = new TextDecoder();
  let code = "";

  for await (const chunk of reader.chunks()) code += decoder.decode(chunk, { stream: true });

  return code + decoder.decode();
}
