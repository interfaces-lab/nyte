import type { ReactElement, ReactNode } from "react";
import { Badge, Bar, Code, Collapse, Field, States, Swap, Text } from "../../.local/stageshow-kit";
import { FINDINGS, FIRST_GUIDE, PULL, counts, findFile, hunkLines, type Finding } from "./data";
import { Glyph } from "./icons";
import { HEADS, fileState, type S, type Take } from "./model";
import { units, type Unit } from "./units";

export function Sidebar(): ReactElement {
  const row = (width: number, icon?: ReactNode): ReactElement => (
    <div className="gr-side__row">
      {icon ?? <span className="gr-side__dot" />}
      <Bar w={width} h={6} tone={3} />
    </div>
  );

  return (
    <div className="gr-side">
      <div className="gr-side__group">
        {row(64, <Glyph name="list" className="gr-icon" />)}
        {row(48, <Glyph name="clock" className="gr-icon" />)}
      </div>
      <div className="gr-side__group">
        <div className="gr-side__label">
          <Bar w={38} h={5} tone={2} />
        </div>
        {row(112)}
        {row(86)}
        {row(124)}
      </div>
      <div className="gr-side__group">
        <Text className="gr-side__label gr-side__label--real">Stacks</Text>
        <div className="gr-side__row" data-active>
          <Glyph name="layers" className="gr-icon" />
          <Text className="gr-side__name">Polish</Text>
          <span className="gr-side__count">1</span>
        </div>
        {row(70, <Glyph name="layers" className="gr-icon" />)}
      </div>
    </div>
  );
}

export function Tabs({ s }: { readonly s: S }): ReactElement {
  return (
    <div className="gr-tabs">
      <span className="gr-tab">
        <Bar w={58} h={5} tone={3} />
      </span>
      <span className="gr-tab" data-active>
        <Glyph name={s.screen === "item" ? "layers" : "diff"} className="gr-icon" />
        <Swap id={s.screen}>
          <span className="gr-tab__label">{s.screen === "item" ? "Polish" : "Changes"}</span>
        </Swap>
      </span>
    </div>
  );
}

export function ItemPage({ take }: { readonly take: Take }): ReactElement {
  const pieces = take.story === "before" ? [] : units(take.cut, FIRST_GUIDE);

  return (
    <div className="gr-item">
      <div className="gr-item__head">
        <div className="gr-item__line">
          <span className="gr-item__title">Review #{PULL.number}</span>
          <Badge tone="warning" dot>
            Needs you
          </Badge>
        </div>
        <span className="gr-item__sub">{PULL.title}</span>
      </div>
      <div className="gr-item__timeline">
        <div className="gr-event">
          <span className="gr-event__avatar" />
          <Bar w={180} h={6} tone={3} />
        </div>
        <div className="gr-event">
          <span className="gr-event__avatar" />
          <Bar w={132} h={6} tone={3} />
        </div>
        <div className="gr-event gr-event--real">
          <span className="gr-event__avatar" data-lead />
          <div className="gr-event__main">
            <span className="gr-event__line">
              <strong>{take.story === "before" ? "Nyte" : "Polish lead"}</strong>{" "}
              {take.story === "before" ? "sorted the files" : "wrote a guide"}
            </span>
            <div className="gr-card">
              <div className="gr-card__head">
                <Glyph name="book" className="gr-icon" />
                <span>{take.story === "before" ? "8 files, no guide yet" : "Review guide"}</span>
              </div>
              {pieces.length > 0 && <p className="gr-card__summary">{FIRST_GUIDE.summary}</p>}
              {pieces.length > 0 && (
                <ol className="gr-card__list">
                  {pieces.slice(0, 4).map((unit, index) => (
                    <li key={unit.id}>
                      <span className="gr-card__num">{String(index + 1)}</span>
                      {unit.title}
                    </li>
                  ))}
                </ol>
              )}
              <div className="gr-card__foot">
                <span className="gr-button" data-target="open-guide" data-cursor="pointer">
                  Open Guide
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="gr-event">
          <span className="gr-event__avatar" />
          <Bar w={156} h={6} tone={3} />
        </div>
        <div className="gr-event">
          <span className="gr-event__avatar" />
          <Bar w={104} h={6} tone={3} />
        </div>
      </div>
    </div>
  );
}

export function NextRow({
  take,
  next,
  index,
}: {
  readonly take: Take;
  readonly next: Unit | undefined;
  readonly index: number;
}): ReactElement {
  if (next === undefined)
    return (
      <div className="gr-next">
        <span className="gr-next__label">Last of the guide</span>
      </div>
    );

  return (
    <div className="gr-next">
      <span className="gr-next__label">Next</span>
      {take.cut === "stops" && <span className="gr-card__num">{String(index + 1)}</span>}
      <span className="gr-next__title">{next.title}</span>
      <span className="gr-spacer" />
      <kbd>K</kbd>
      <kbd>J</kbd>
    </div>
  );
}

export function Pages({
  current,
  children,
}: {
  readonly current: number;
  readonly children: readonly ReactElement[];
}): ReactElement {
  return (
    <div className="gr-pages">
      {children.map((child, index) => (
        <div
          key={child.key ?? index}
          className="gr-page"
          data-show={index === current || undefined}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

export function Attention({
  attention,
}: {
  readonly attention: NonNullable<Unit["attention"]>;
}): ReactElement {
  return (
    <div className="gr-attention">
      <Glyph name="eye" size={14} className="gr-icon" />
      <span>
        <strong>{attention.kind}</strong> {attention.note}
      </span>
    </div>
  );
}

export function Ask({ s }: { readonly s: S }): ReactElement {
  return (
    <div className="gr-ask">
      <Collapse open={s.asking}>
        <div className="gr-ask__field">
          <Field
            value={s.typed}
            placeholder="Ask the Polish lead…"
            focused={s.asking}
            box={{ "data-cursor": "ibeam" }}
          />
          <span className="gr-send" data-target="send-ask" data-cursor="pointer">
            <Glyph name="arrow-up" size={14} />
          </span>
        </div>
      </Collapse>
      <Collapse open={s.asked} reveal="drop">
        <div className="gr-asked">
          <span className="gr-asked__text">{s.typed}</span>
          <span className="gr-asked__to">
            <Glyph name="checkmark" size={12} /> Sent to Polish lead
          </span>
        </div>
      </Collapse>
    </div>
  );
}

export function FileBlock({
  take,
  s,
  path,
  note,
  diff,
}: {
  readonly take: Take;
  readonly s: S;
  readonly path: string;
  readonly note: string | null;
  readonly diff: boolean;
}): ReactElement | null {
  const file = findFile(HEADS[s.head], path);

  if (file === undefined) return null;

  const size = counts(file);
  const slash = path.lastIndexOf("/");
  const state = fileState(s, path);
  const preview = file.preview ?? { hunk: 0, from: 0, to: 9 };
  const block = diff ? hunkLines(file, preview.hunk, preview.from, preview.to) : null;

  const findings =
    take.findings === "inline" && take.story === "findings"
      ? FINDINGS.filter((finding) => finding.path === path)
      : [];

  return (
    <div className="gr-file">
      <div className="gr-file__row">
        <Glyph name="file-text" className="gr-icon" />
        <span className="gr-file__path">
          <span className="gr-file__dir">{path.slice(0, slash + 1)}</span>
          <span className="gr-file__base">{path.slice(slash + 1)}</span>
        </span>
        <span className="gr-counts">
          {size.added > 0 && <span className="gr-add">+{size.added}</span>}
          {size.removed > 0 && <span className="gr-del">−{size.removed}</span>}
        </span>
        <span
          className="gr-viewed"
          data-state={state}
          data-target={`view:${path}`}
          data-cursor="pointer"
        >
          <span className="gr-viewed__box">
            <Glyph name="checkmark" size={10} />
          </span>
          <States
            value={state}
            align="start"
            states={{ unviewed: "Viewed", viewed: "Viewed", changed: "Changed" }}
          />
        </span>
      </div>
      {note !== null && <p className="gr-file__note">{note}</p>}
      {block !== null && block.lines.length > 0 && (
        <Code lines={[...block.lines]} start={block.start} className="gr-code" />
      )}
      {findings.map((finding) => (
        <FindingRow key={finding.id} finding={finding} s={s} compact />
      ))}
    </div>
  );
}

export function FindingsList({ s }: { readonly s: S }): ReactElement {
  return (
    <div className="gr-findings">
      {FINDINGS.map((finding) => (
        <FindingRow key={finding.id} finding={finding} s={s} compact={false} />
      ))}
    </div>
  );
}

function FindingRow({
  finding,
  s,
  compact,
}: {
  readonly finding: Finding;
  readonly s: S;
  readonly compact: boolean;
}): ReactElement {
  const kept = !s.dropped.includes(finding.id);
  const slash = finding.path.lastIndexOf("/");

  return (
    <div
      className="gr-finding"
      data-compact={compact || undefined}
      data-dropped={!kept || undefined}
    >
      <span
        className="gr-viewed__box"
        data-on={kept || undefined}
        data-target={`keep:${finding.id}`}
        data-cursor="pointer"
      >
        <Glyph name="checkmark" size={10} />
      </span>
      <div className="gr-finding__main">
        <div className="gr-finding__head">
          <Badge tone={finding.severity === "fix" ? "warning" : "neutral"}>
            {finding.severity}
          </Badge>
          <span className="gr-finding__title">{finding.title}</span>
          {!compact && (
            <span className="gr-finding__where">
              {finding.path.slice(slash + 1)}:{String(finding.line)}
            </span>
          )}
        </div>
        <p className="gr-finding__detail">{finding.detail}</p>
      </div>
    </div>
  );
}

export function ReadMark({ on }: { readonly on: boolean }): ReactElement {
  return (
    <span className="gr-read" data-on={on || undefined} aria-label={on ? "Read" : "Not read"}>
      <Glyph name="checkmark" size={10} />
    </span>
  );
}
