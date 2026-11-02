import type { ReactElement } from "react";
import {
  Badge,
  Code,
  Collapse,
  Count,
  Meter,
  Roll,
  Scroll,
  Segmented,
  Spinner,
  Stage,
  States,
  Swap,
  Window,
} from "../../.local/stageshow-kit";
import {
  EMPTY_PATH,
  FINDINGS,
  FIRST,
  FIRST_GUIDE,
  PULL,
  SECOND,
  WRITING_STEPS,
  findFile,
  hunkLines,
} from "./data";
import { Glyph } from "./icons";
import { ASK_LABEL, HEADS, NOUN, TOTALS, finished, guideUnits, type S, type Take } from "./model";
import {
  Ask,
  Attention,
  FileBlock,
  FindingsList,
  ItemPage,
  NextRow,
  Pages,
  ReadMark,
  Sidebar,
  Tabs,
} from "./parts";
import { REST, opening, poster, script } from "./script";
import { sorted, type Unit } from "./units";
import "./review.css";

export type { FindingsAt, Placement, Reading, Story, Take } from "./model";

export function GuidedReview({
  take,
  theme,
  className,
}: {
  readonly take: Take;
  readonly theme?: "light" | "dark";
  readonly className?: string;
}): ReactElement {
  return (
    <Stage
      width={1040}
      height={640}
      initial={opening(take)}
      poster={poster(take)}
      script={script(take)}
      play="once"
      cursor={{ at: REST }}
      theme={theme}
      className={["gr-stage", className].filter(Boolean).join(" ")}
    >
      {(s) => <Scene take={take} s={s} />}
    </Stage>
  );
}

function Scene({ take, s }: { readonly take: Take; readonly s: S }): ReactElement {
  return (
    <Window
      className="gr-window"
      sidebar={<Sidebar />}
      sidebarWidth={208}
      lead={<Tabs s={s} />}
      body={{ className: "gr-body" }}
    >
      <div className="gr-screens">
        <div className="gr-screen" data-show={s.screen === "item" || undefined}>
          <ItemPage take={take} />
        </div>
        <div className="gr-screen" data-show={s.screen === "review" || undefined}>
          <Review take={take} s={s} />
        </div>
      </div>
    </Window>
  );
}

function Review({ take, s }: { readonly take: Take; readonly s: S }): ReactElement {
  const pieces = s.phase === "ready" ? guideUnits(take, s) : sorted();
  const read = pieces.filter((unit) => finished(s, unit)).length;
  const kept = FINDINGS.filter((finding) => !s.dropped.includes(finding.id)).length;
  const findingsTab = take.findings === "tab";

  return (
    <div className="gr-review" data-placement={take.placement === "rail" ? "rail" : "tab"}>
      <header className="gr-pr">
        <div className="gr-pr__title" data-target="rest">
          <Glyph name="pull-request" className="gr-icon gr-icon--open" />
          <span className="gr-pr__name">{PULL.title}</span>
          <span className="gr-pr__number">#{PULL.number}</span>
        </div>
        <div className="gr-pr__meta">
          <span className="gr-chip">
            <Glyph name="git-branch" size={12} className="gr-icon" />
            {PULL.branch}
          </span>
          <span className="gr-counts">
            <span className="gr-add">+{TOTALS.added}</span>
            <span className="gr-del">−{TOTALS.removed}</span>
          </span>
          <span className="gr-spacer" />
          {findingsTab && (
            <Segmented
              className="gr-segmented"
              items={[
                "Guide",
                "Files",
                <span key="findings" className="gr-seg-count">
                  Findings <span className="gr-pill">{FINDINGS.length}</span>
                </span>,
              ]}
              value={s.view === "findings" ? 2 : 0}
              targets={[undefined, undefined, "tab-findings"]}
            />
          )}
          {take.findings !== "off" && take.story === "findings" && (
            <span
              className="gr-button"
              data-solid
              data-target="send-findings"
              data-cursor="pointer"
            >
              <States
                value={s.sending}
                states={{
                  idle: (
                    <span className="gr-button__row">
                      <Roll variant="fade">{`Send ${String(kept)} Comments`}</Roll>
                    </span>
                  ),
                  sending: (
                    <span className="gr-button__row">
                      <Spinner size={12} /> Sending
                    </span>
                  ),
                  sent: (
                    <span className="gr-button__row">
                      <Glyph name="checkmark" size={12} /> Sent to {PULL.author}
                    </span>
                  ),
                }}
              />
            </span>
          )}
        </div>
      </header>

      <Collapse open={s.phase !== "ready"}>
        <div className="gr-banner">
          <Glyph name="list" className="gr-icon" />
          <span className="gr-banner__text">
            {s.phase === "writing" ? (
              <Swap id={s.step}>
                <span>{WRITING_STEPS[s.step] ?? ""}</span>
              </Swap>
            ) : (
              "Sorted by kind. No model has read this yet."
            )}
          </span>
          <span className="gr-button" data-target="write-guide" data-cursor="pointer">
            <States
              value={s.phase === "writing" ? "writing" : "idle"}
              states={{
                idle: <span className="gr-button__row">Write Guide</span>,
                writing: (
                  <span className="gr-button__row">
                    <Spinner size={12} /> Writing
                  </span>
                ),
              }}
            />
          </span>
        </div>
      </Collapse>

      <Collapse open={s.head !== s.guideHead || s.rewriting}>
        <div className="gr-banner" data-tone="warning">
          <Glyph name="git-branch" className="gr-icon" />
          <span className="gr-banner__text">
            {PULL.author} pushed <code>{SECOND.oid}</code>. This guide describes{" "}
            <code>{FIRST.oid}</code>.
          </span>
          <span className="gr-button" data-target="rewrite" data-cursor="pointer">
            <States
              value={s.rewriting ? "writing" : "idle"}
              states={{
                idle: <span className="gr-button__row">Rewrite Guide</span>,
                writing: (
                  <span className="gr-button__row">
                    <Spinner size={12} /> Reading the push
                  </span>
                ),
              }}
            />
          </span>
        </div>
      </Collapse>

      <div className="gr-progress">
        <span className="gr-progress__label">
          {s.phase === "ready" ? "Guide" : "Files"}
          {s.phase === "ready" && (
            <span className="gr-progress__head">
              <Swap id={s.guideHead}>
                <code>{HEADS[s.guideHead].oid}</code>
              </Swap>
            </span>
          )}
        </span>
        <Meter value={pieces.length === 0 ? 0 : read / pieces.length} tone="ink" />
        <span className="gr-progress__count">
          <Count value={read} /> of {pieces.length}{" "}
          {s.phase === "ready" ? NOUN[take.cut] : "groups"} read
        </span>
      </div>

      <div className="gr-views">
        <div className="gr-view" data-show={s.view === "guide" || undefined}>
          {take.placement === "rail" ? (
            <Rail take={take} s={s} pieces={pieces} />
          ) : (
            <Scroll name="guide" className="gr-scroll" bar="none">
              {s.phase !== "ready" ? (
                pieces.map((unit, index) => (
                  <UnitCard key={unit.id} take={take} s={s} unit={unit} index={index} />
                ))
              ) : take.reading === "one" ? (
                <Pages current={s.current}>
                  {pieces.map((unit, index) => (
                    <div key={unit.id}>
                      <UnitCard take={take} s={s} unit={unit} index={index} />
                      <NextRow take={take} next={pieces[index + 1]} index={index + 1} />
                    </div>
                  ))}
                </Pages>
              ) : (
                pieces.map((unit, index) => (
                  <Collapse key={unit.id} open={index < s.arrived} reveal="drop">
                    <UnitCard take={take} s={s} unit={unit} index={index} />
                  </Collapse>
                ))
              )}
            </Scroll>
          )}
        </div>
        {findingsTab && (
          <div className="gr-view" data-show={s.view === "findings" || undefined}>
            <FindingsList s={s} />
          </div>
        )}
      </div>
    </div>
  );
}

function UnitCard({
  take,
  s,
  unit,
  index,
}: {
  readonly take: Take;
  readonly s: S;
  readonly unit: Unit | undefined;
  readonly index: number;
}): ReactElement | null {
  if (unit === undefined) return null;

  const head = HEADS[s.head];

  const updated =
    take.story === "moved" &&
    s.guideHead === "second" &&
    unit.files.some((file) => file.path === EMPTY_PATH);

  const asks = take.story === "read" && s.phase === "ready";
  const askHere = asks && index === s.current;

  return (
    <section className="gr-unit" data-target={`unit-${String(index)}`} data-cut={take.cut}>
      <div className="gr-unit__head">
        {unit.mark !== null && (
          <span className="gr-unit__mark" data-kind={take.cut}>
            {unit.mark}
          </span>
        )}
        <span className="gr-unit__title">{unit.title}</span>
        {take.story === "moved" && (
          <span className="gr-updated" data-show={updated || undefined}>
            <Badge tone="accent">Updated</Badge>
          </span>
        )}
        <span className="gr-spacer" />
        {asks && (
          <span
            className="gr-button"
            data-quiet
            data-target={askHere ? "ask" : undefined}
            data-cursor="pointer"
          >
            <span className="gr-button__row">
              <Glyph name="bubble-question" size={13} />
              {ASK_LABEL[take.cut]}
            </span>
          </span>
        )}
        <ReadMark on={finished(s, unit)} />
      </div>

      {unit.why !== null && (
        <Swap id={`${unit.id}:${s.guideHead}`} className="gr-why-swap">
          <p className="gr-unit__why">{unit.why}</p>
        </Swap>
      )}

      {unit.attention !== null && <Attention attention={unit.attention} />}

      {askHere && <Ask s={s} />}

      <div className="gr-files" data-folded={unit.folded || undefined}>
        {unit.files.map((entry) => (
          <FileBlock
            key={entry.path}
            take={take}
            s={s}
            path={entry.path}
            note={entry.note}
            diff={unit.diffs && !unit.folded}
          />
        ))}
      </div>

      {unit.excerpts.map((excerpt) => {
        const file = findFile(head, excerpt.path);

        const block =
          file === undefined ? null : hunkLines(file, excerpt.hunk, excerpt.from, excerpt.to);

        return block === null ? null : (
          <figure key={`${excerpt.path}:${String(excerpt.hunk)}`} className="gr-excerpt">
            <Code lines={[...block.lines]} start={block.start} className="gr-code" />
            <figcaption>{excerpt.caption}</figcaption>
          </figure>
        );
      })}
    </section>
  );
}

function Rail({
  take,
  s,
  pieces,
}: {
  readonly take: Take;
  readonly s: S;
  readonly pieces: readonly Unit[];
}): ReactElement {
  const ready = s.phase === "ready";

  const files = (unit: Unit): ReactElement => (
    <div>
      {unit.files.map((entry) => (
        <FileBlock key={entry.path} take={take} s={s} path={entry.path} note={null} diff />
      ))}
    </div>
  );

  return (
    <div className="gr-split">
      <Scroll name="guide" className="gr-scroll gr-rail" bar="none">
        {ready && <p className="gr-rail__summary">{FIRST_GUIDE.summary}</p>}
        {pieces.map((unit, index) => {
          const current = ready && index === s.current;
          const open = ready && (take.reading === "all" || current);
          const askHere = current && take.story === "read";

          return (
            <div
              key={unit.id}
              className="gr-stop"
              data-current={current || undefined}
              data-target={`unit-${String(index)}`}
            >
              <div className="gr-stop__row">
                {unit.mark !== null && (
                  <span className="gr-unit__mark" data-kind={take.cut}>
                    {unit.mark}
                  </span>
                )}
                <span className="gr-stop__title">{unit.title}</span>
                <span className="gr-spacer" />
                <ReadMark on={finished(s, unit)} />
              </div>
              <Collapse open={open && unit.why !== null}>
                <Swap id={`${unit.id}:${s.guideHead}`} className="gr-why-swap">
                  <p className="gr-unit__why">{unit.why}</p>
                </Swap>
                {unit.attention !== null && <Attention attention={unit.attention} />}
                {askHere && (
                  <div className="gr-stop__actions">
                    <Collapse open={!s.asking && !s.asked}>
                      <span
                        className="gr-button"
                        data-quiet
                        data-target="ask"
                        data-cursor="pointer"
                      >
                        <span className="gr-button__row">
                          <Glyph name="bubble-question" size={13} />
                          {ASK_LABEL[take.cut]}
                        </span>
                      </span>
                    </Collapse>
                    <Ask s={s} />
                  </div>
                )}
              </Collapse>
            </div>
          );
        })}
      </Scroll>
      <Scroll name="diff" className="gr-scroll gr-diffs" bar="none">
        {ready && take.reading === "one" ? (
          <Pages current={s.current}>
            {pieces.map((unit) => (
              <div key={unit.id}>{files(unit)}</div>
            ))}
          </Pages>
        ) : (
          pieces.map((unit) => <div key={unit.id}>{files(unit)}</div>)
        )}
      </Scroll>
    </div>
  );
}
