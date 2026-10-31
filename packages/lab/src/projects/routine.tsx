import { props } from "@stylexjs/stylex";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { MODELS } from "./dials.ts";
import type { Evidence } from "./evidence.ts";
import type { Budget, Dispatch, Lane } from "./lane.ts";
import { backtest, brief, laneRoutine, sameRoutine, workflows } from "./routine.ts";
import type { Backtest, Brief, Catch, Fix, Outcome, Routine, Scope, Word } from "./routine.ts";
import { routineStyles } from "./routine.stylex";
import type { Knobs, ModelId } from "./world.ts";

const OUTCOMES = {
  main: { label: "Main's failure, fixed once there", tint: intent.primary },
  shared: { label: "Shared with other PRs, handled once", tint: surfaceTheme.purple },
  babysitter: { label: "Its babysitter fixes it", tint: intent.warning },
  stopped: { label: "Stops on its budget", tint: intent.danger },
} as const;

type Tinted = (typeof OUTCOMES)[Outcome]["tint"];

const ORDER: readonly Outcome[] = ["babysitter", "stopped", "shared", "main"];

const SCOPES: readonly { readonly value: Scope; readonly label: string }[] = [
  { value: "chats", label: "your chats" },
  { value: "anyone", label: "anyone" },
];

const SHARED: readonly { readonly value: "once" | "each"; readonly label: string }[] = [
  { value: "once", label: "fixed once" },
  { value: "each", label: "fixed in each" },
];

const ROWS = 4;

const TRIES = { min: 1, max: 6 };

const USD = { min: 0.5, max: 10, step: 0.5 };

const KEYS = [
  { key: "ArrowLeft", tries: -1, usd: 0 },
  { key: "ArrowRight", tries: 1, usd: 0 },
  { key: "ArrowUp", tries: 0, usd: USD.step },
  { key: "ArrowDown", tries: 0, usd: -USD.step },
] as const;

/** Percent of the pad kept clear on every side, so the handle never clips at an edge. */
const INSET = 8;

function modelName(model: ModelId): string {
  return MODELS.find((option) => option.value === model)?.label ?? model;
}

function dollars(usd: number): string {
  return Number.isInteger(usd) ? `$${String(usd)}` : `$${usd.toFixed(2)}`;
}

function tries(count: number): string {
  return `${String(count)} ${count === 1 ? "try" : "tries"}`;
}

/** `pnpm changeset status --since=…` reads as `pnpm changeset status`. */
function shortStep(step: string): string {
  return step.split(" --")[0] ?? step;
}

export function Triggers({
  evidence,
  lane,
  knobs,
  created,
  onCreate,
}: {
  readonly evidence: Evidence;
  readonly lane: Lane;
  readonly knobs: Knobs;
  readonly created: readonly Routine[];
  readonly onCreate: (routine: Routine) => void;
}): ReactElement {
  const [draft, setDraft] = useState<Routine | null>(null);
  const heading = useId();
  const current = laneRoutine(lane, knobs);
  const checks = workflows(evidence);

  const saved = [
    { key: "lane", routine: current, badge: "Built in" },
    ...created.map((routine, index) => ({ key: String(index), routine, badge: "Active" })),
  ];

  return (
    <section aria-labelledby={heading} {...props(routineStyles.section)}>
      <header {...props(routineStyles.sectionHeader)}>
        <h2 id={heading} {...props(routineStyles.sectionTitle)}>
          Triggers
        </h2>
        {draft === null && (
          <Button size="sm" icon="plus" onClick={() => setDraft(current)}>
            New Trigger
          </Button>
        )}
      </header>
      {draft !== null && (
        <Composer
          evidence={evidence}
          knobs={knobs}
          current={current}
          draft={draft}
          checks={checks}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onCreate={() => {
            onCreate(draft);
            setDraft(null);
          }}
        />
      )}
      <ul {...props(routineStyles.list)}>
        {saved.map((entry) => {
          const tested = backtest(evidence, entry.routine, knobs);

          return (
            <li key={entry.key} {...props(routineStyles.saved)}>
              <div {...props(routineStyles.block)}>
                <Sentence routine={entry.routine} checks={checks} quiet />
                <p {...props(routineStyles.label)}>
                  Caught {tested.caught.length} of the last {tested.total} pull requests ·{" "}
                  {runsLine(tested)}
                </p>
              </div>
              <span
                {...props(
                  entry.badge === "Active" && intent.success,
                  routineStyles.badge,
                  entry.badge === "Active" && routineStyles.badgeTinted,
                )}
              >
                {entry.badge}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function runsLine(tested: Backtest): string {
  if (tested.plan.runs === 0) return "no model runs";

  return `${String(tested.plan.runs)} model ${tested.plan.runs === 1 ? "run" : "runs"}, about ${dollars(Math.round(tested.usd))}`;
}

function Composer({
  evidence,
  knobs,
  current,
  draft,
  checks,
  onChange,
  onClose,
  onCreate,
}: {
  readonly evidence: Evidence;
  readonly knobs: Knobs;
  readonly current: Routine;
  readonly draft: Routine;
  readonly checks: readonly string[];
  readonly onChange: (routine: Routine) => void;
  readonly onClose: () => void;
  readonly onCreate: () => void;
}): ReactElement {
  const [selected, setSelected] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const pad = useRef<HTMLDivElement>(null);
  const tested = backtest(evidence, draft, knobs);
  const sample = tested.caught.find((entry) => entry.pull.number === selected) ?? tested.caught[0];
  const unchanged = sameRoutine(draft, current);

  return (
    <section aria-label="New trigger" {...props(routineStyles.card)}>
      <header {...props(routineStyles.header)}>
        <span {...props(intent.primary, routineStyles.headerGlyph)}>
          <Icon name="filters" size={16} />
        </span>
        <h3 {...props(routineStyles.headerTitle)}>New trigger</h3>
        <span {...props(routineStyles.badge)}>Draft</span>
        <Button
          size="sm"
          iconOnly
          icon="x"
          aria-label="Discard trigger"
          xstyle={routineStyles.push}
          onClick={onClose}
        />
      </header>
      <div {...props(routineStyles.sentenceWell)}>
        <Sentence
          routine={draft}
          checks={checks}
          onChange={onChange}
          onBudget={() => pad.current?.focus()}
        />
      </div>
      <Catches
        tested={tested}
        model={modelName(draft.model)}
        selected={sample?.pull.number ?? null}
        onSelect={setSelected}
      />
      <BudgetPad
        padRef={pad}
        budget={draft.budget}
        start={current.budget}
        fix={tested.fix}
        model={modelName(draft.model)}
        onChange={(budget) => onChange({ ...draft, budget })}
      />
      {sample !== undefined && (
        <BriefPreview
          number={sample.pull.number}
          preview={brief(evidence, draft, current, knobs, sample.pull)}
        />
      )}
      {testing && <DryRun tested={tested} />}
      <footer {...props(routineStyles.footer)}>
        <Button variant="outline" icon="test-tube" onClick={() => setTesting((open) => !open)}>
          {testing ? "Hide Test" : "Test"}
        </Button>
        <Button
          variant="solid"
          tone="primary"
          icon="checkmark"
          disabled={draft.gate.length === 0 || unchanged}
          disabledReason={
            draft.gate.length === 0 ? "Pick a check to catch" : "Same as the built-in trigger"
          }
          onClick={onCreate}
        >
          Create Trigger
        </Button>
      </footer>
    </section>
  );
}

function Sentence({
  routine,
  checks,
  quiet = false,
  onChange,
  onBudget,
}: {
  readonly routine: Routine;
  readonly checks: readonly string[];
  readonly quiet?: boolean;
  readonly onChange?: (routine: Routine) => void;
  readonly onBudget?: () => void;
}): ReactElement {
  const missing = checks.filter((check) => !routine.gate.includes(check));
  const shared = routine.shared ? "once" : "each";

  return (
    <p {...props(routineStyles.sentence, quiet && routineStyles.sentenceQuiet)}>
      <span>Pull requests from</span>
      <Choice<Scope>
        value={routine.scope}
        options={SCOPES}
        quiet={quiet}
        onPick={onChange && ((scope) => onChange({ ...routine, scope }))}
      />
      <span>that fail</span>
      {routine.gate.map((check) => (
        <span
          key={check}
          {...props(
            routineStyles.chip,
            routineStyles.chipMono,
            routineStyles.chipHold,
            quiet && routineStyles.chipStatic,
            onChange !== undefined && routineStyles.chipRemovable,
          )}
        >
          {check}
          {onChange !== undefined && (
            <Button
              size="2xs"
              iconOnly
              icon="x"
              aria-label={`Stop catching ${check}`}
              onClick={() =>
                onChange({ ...routine, gate: routine.gate.filter((entry) => entry !== check) })
              }
            />
          )}
        </span>
      ))}
      {onChange !== undefined && missing.length > 0 && (
        <Menu>
          <MenuTrigger
            aria-label="Catch another check"
            {...props(focus.ring, routineStyles.chip, routineStyles.chipMono)}
          >
            +{missing.length}
          </MenuTrigger>
          <MenuContent>
            {missing.map((check) => (
              <MenuItem
                key={check}
                onClick={() =>
                  onChange({
                    ...routine,
                    gate: checks.filter((entry) => entry === check || routine.gate.includes(entry)),
                  })
                }
              >
                {check}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}
      <span>go to</span>
      <Choice<ModelId>
        value={routine.model}
        options={MODELS}
        quiet={quiet}
        tint={intent.warning}
        prefix="a babysitter on "
        onPick={onChange && ((model) => onChange({ ...routine, model }))}
      />
      <span>with</span>
      {onBudget === undefined ? (
        <span {...props(routineStyles.chip, routineStyles.chipHold, routineStyles.chipStatic)}>
          {tries(routine.budget.attempts)} · {dollars(routine.budget.usd)}
        </span>
      ) : (
        <button
          type="button"
          aria-label={`${tries(routine.budget.attempts)} and ${dollars(routine.budget.usd)} each. Tune on the pad below.`}
          onClick={onBudget}
          {...props(focus.ring, routineStyles.chip)}
        >
          {tries(routine.budget.attempts)} · {dollars(routine.budget.usd)}
        </button>
      )}
      <span>each. Failures they share are</span>
      <Choice
        value={shared}
        options={SHARED}
        quiet={quiet}
        tint={intent.primary}
        onPick={onChange && ((value) => onChange({ ...routine, shared: value === "once" }))}
      />
    </p>
  );
}

function Choice<T extends string>({
  value,
  options,
  quiet,
  tint,
  prefix = "",
  onPick,
}: {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly quiet: boolean;
  readonly tint?: Tinted;
  readonly prefix?: string;
  readonly onPick: ((value: T) => void) | undefined;
}): ReactElement {
  const label = `${prefix}${options.find((option) => option.value === value)?.label ?? value}`;

  if (onPick === undefined)
    return (
      <span
        {...props(
          tint,
          routineStyles.chip,
          routineStyles.chipHold,
          quiet && routineStyles.chipStatic,
          tint !== undefined && routineStyles.chipTintedHold,
        )}
      >
        {label}
      </span>
    );

  return (
    <Menu>
      <MenuTrigger
        {...props(
          tint,
          focus.ring,
          routineStyles.chip,
          tint !== undefined && routineStyles.chipTinted,
        )}
      >
        {label}
        <Icon name="chevron-down" size={12} />
      </MenuTrigger>
      <MenuContent>
        <MenuRadioGroup value={value}>
          {options.map((option) => (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              onClick={() => onPick(option.value)}
            >
              {prefix}
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function Catches({
  tested,
  model,
  selected,
  onSelect,
}: {
  readonly tested: Backtest;
  readonly model: string;
  readonly selected: number | null;
  readonly onSelect: (pull: number) => void;
}): ReactElement {
  const [all, setAll] = useState(false);
  const rows = all ? tested.caught : tested.caught.slice(0, ROWS);

  const present = ORDER.filter((outcome) =>
    tested.caught.some((entry) => entry.checks.some((check) => check.outcome === outcome)),
  );

  return (
    <div {...props(routineStyles.block)}>
      <div {...props(routineStyles.sectionHeader)}>
        <span {...props(routineStyles.label)}>Would catch</span>
        <span {...props(intent.primary, routineStyles.figure)}>
          {tested.caught.length} of last {tested.total}
        </span>
      </div>
      <p {...props(routineStyles.summary)}>
        {tested.caught.length === 0
          ? `Nothing in the last ${String(tested.total)} pull requests would have set it off.`
          : summarize(tested, model)}
      </p>
      {rows.length > 0 && (
        <ul aria-label="Pull requests it would catch" {...props(routineStyles.catches)}>
          {rows.map((entry) => (
            <CatchRow
              key={entry.pull.number}
              entry={entry}
              selected={entry.pull.number === selected}
              onSelect={() => onSelect(entry.pull.number)}
            />
          ))}
        </ul>
      )}
      {present.length > 0 && (
        <div {...props(routineStyles.legend)}>
          {present.map((outcome) => (
            <span key={outcome} {...props(routineStyles.legendItem)}>
              <span {...props(OUTCOMES[outcome].tint, routineStyles.dot)} />
              {OUTCOMES[outcome].label}
            </span>
          ))}
          {tested.caught.length > ROWS && (
            <Button
              size="xs"
              variant="text"
              xstyle={routineStyles.push}
              onClick={() => setAll(!all)}
            >
              {all ? "Show Fewer" : `Show All ${String(tested.caught.length)}`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function CatchRow({
  entry,
  selected,
  onSelect,
}: {
  readonly entry: Catch;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): ReactElement {
  const outcomes = ORDER.filter((outcome) =>
    entry.checks.some((check) => check.outcome === outcome),
  );

  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        {...props(focus.ringInset, routineStyles.catch, selected && routineStyles.catchSelected)}
      >
        <span {...props(routineStyles.catchNumber)}>#{entry.pull.number}</span>
        <span {...props(routineStyles.catchBody)}>
          <span {...props(routineStyles.catchTitle)}>{entry.pull.title}</span>
          <span {...props(routineStyles.catchSteps)}>
            {entry.checks.map((check) => (
              <span
                key={`${check.step}:${check.outcome}`}
                {...props(OUTCOMES[check.outcome].tint, routineStyles.step)}
              >
                {shortStep(check.step)}
              </span>
            ))}
          </span>
        </span>
        <span
          role="img"
          aria-label={outcomes.map((outcome) => OUTCOMES[outcome].label).join(", ")}
          {...props(routineStyles.dots)}
        >
          {outcomes.map((outcome) => (
            <span key={outcome} {...props(OUTCOMES[outcome].tint, routineStyles.dot)} />
          ))}
        </span>
      </button>
    </li>
  );
}

function summarize(tested: Backtest, model: string): string {
  const count = (outcome: Outcome): number =>
    tested.caught.filter((entry) => entry.checks.some((check) => check.outcome === outcome)).length;

  const lane = tested.plan.dispatches.filter((dispatch) => dispatch.event.pull === null);

  const main = lane.find((dispatch) => !dispatch.event.subject.startsWith("family:"))?.decision;
  const family = lane.find((dispatch) => dispatch.event.subject.startsWith("family:"))?.decision;

  const parts = [
    count("main") > 0
      ? `${String(count("main"))} fail the way main does, so main gets one fix${main?.kind === "remedy" ? ` with no model (${main.command.split(" ").slice(0, 3).join(" ")})` : ""}`
      : null,
    count("shared") > 0
      ? `${String(count("shared"))} share a failure of their own${family?.kind === "ask" ? ", which becomes one question for you" : ", fixed once for all of them"}`
      : null,
    count("babysitter") > 0 ? `${String(count("babysitter"))} wake a babysitter on ${model}` : null,
    count("stopped") > 0 ? `${String(count("stopped"))} stop before any fix` : null,
  ].filter((part) => part !== null);

  const lead =
    tested.plan.runs === 0
      ? "No model would run."
      : `${String(tested.plan.runs)} model ${tested.plan.runs === 1 ? "run" : "runs"}, about ${dollars(Math.round(tested.usd))}.`;

  return `${lead} ${parts.join("; ")}.`;
}

function BudgetPad({
  padRef,
  budget,
  start,
  fix,
  model,
  onChange,
}: {
  readonly padRef: RefObject<HTMLDivElement | null>;
  readonly budget: Budget;
  readonly start: Budget;
  readonly fix: Fix;
  readonly model: string;
  readonly onChange: (budget: Budget) => void;
}): ReactElement {
  const readout = useId();
  const span = 100 - INSET * 2;

  const x = (count: number): number =>
    INSET + ((count - TRIES.min) / (TRIES.max - TRIES.min)) * span;

  const y = (usd: number): number => 100 - INSET - ((usd - USD.min) / (USD.max - USD.min)) * span;

  const count = (left: number): number =>
    TRIES.min + ((left - INSET) / span) * (TRIES.max - TRIES.min);

  const set = (attempts: number, usd: number): void =>
    onChange({
      ...budget,
      attempts: Math.min(TRIES.max, Math.max(TRIES.min, Math.round(attempts))),
      usd: Math.min(USD.max, Math.max(USD.min, Math.round(usd / USD.step) * USD.step)),
    });

  const pick = (event: PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const left = ((event.clientX - box.left) / box.width) * 100;
    const top = ((event.clientY - box.top) / box.height) * 100;

    set(count(left), USD.min + ((100 - INSET - top) / span) * (USD.max - USD.min));
  };

  const press = (event: KeyboardEvent<HTMLDivElement>): void => {
    const move = KEYS.find((candidate) => candidate.key === event.key);

    if (move === undefined) return;
    event.preventDefault();
    set(budget.attempts + move.tries, budget.usd + move.usd);
  };

  const covered = fix.usd === 0 ? budget.attempts : Math.floor(budget.usd / fix.usd);
  const left = x(budget.attempts);
  const top = y(budget.usd);
  const lineLeft = y(count(0) * fix.usd);
  const lineRight = y(count(100) * fix.usd);

  return (
    <div {...props(routineStyles.block)}>
      <div {...props(routineStyles.sectionHeader)}>
        <span {...props(routineStyles.label)}>Each pull request gets</span>
        <span {...props(intent.primary, routineStyles.figure)}>
          {tries(budget.attempts)} · {dollars(budget.usd)}
        </span>
      </div>
      <div
        ref={padRef}
        role="group"
        tabIndex={0}
        aria-label={`Tries and budget per pull request: ${tries(budget.attempts)}, ${dollars(budget.usd)}. Arrow keys change them.`}
        aria-describedby={readout}
        onKeyDown={press}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event);
        }}
        {...props(focus.ring, routineStyles.pad)}
      >
        {fix.usd > 0 && (
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            {...props(intent.primary, routineStyles.padRegion)}
          >
            <polygon
              points={`0,${String(lineLeft)} 100,${String(lineRight)} 100,100 0,100`}
              {...props(routineStyles.padFill)}
            />
            <line x1={0} y1={lineLeft} x2={100} y2={lineRight} {...props(routineStyles.padLine)} />
          </svg>
        )}
        <span
          aria-hidden="true"
          {...props(
            routineStyles.padAxis,
            routineStyles.padAxisX,
            routineStyles.at("0", `${String(y(start.usd))}%`),
          )}
        />
        <span
          aria-hidden="true"
          {...props(
            routineStyles.padAxis,
            routineStyles.padAxisY,
            routineStyles.at(`${String(x(start.attempts))}%`, "0"),
          )}
        />
        <span
          aria-hidden="true"
          {...props(
            routineStyles.padDefault,
            routineStyles.at(`${String(x(start.attempts))}%`, `${String(y(start.usd))}%`),
          )}
        />
        <span
          aria-hidden="true"
          {...props(routineStyles.padCorner, routineStyles.at("8px", "6px"))}
        >
          {dollars(USD.max)}
        </span>
        <span
          aria-hidden="true"
          {...props(routineStyles.padCorner, routineStyles.at("8px", "calc(100% - 22px)"))}
        >
          {tries(TRIES.min)}
        </span>
        <span
          aria-hidden="true"
          {...props(routineStyles.padCorner, routineStyles.at("calc(100% - 64px)", "6px"))}
        >
          {tries(TRIES.max)}
        </span>
        {fix.usd > 0 && (
          <span aria-hidden="true" {...props(intent.primary, routineStyles.padRegionLabel)}>
            Budget runs out first
          </span>
        )}
        <span
          aria-hidden="true"
          {...props(
            intent.primary,
            routineStyles.padHandle,
            routineStyles.at(`${String(left)}%`, `${String(top)}%`),
          )}
        />
        <span
          id={readout}
          {...props(
            routineStyles.padReadout,
            left > 60
              ? routineStyles.at(`calc(${String(left)}% - 172px)`, `calc(${String(top)}% - 16px)`)
              : routineStyles.at(`calc(${String(left)}% + 20px)`, `calc(${String(top)}% - 16px)`),
          )}
        >
          <span>
            {tries(budget.attempts)} · {dollars(budget.usd)}
          </span>
          <span {...props(intent.primary, routineStyles.changed)}>
            {fix.samples === 0
              ? "no fixes on record"
              : covered >= budget.attempts
                ? `covers every try on ${model}`
                : covered === 0
                  ? `less than one ${model} fix`
                  : `covers ${tries(covered)} on ${model}`}
          </span>
        </span>
      </div>
      <p {...props(routineStyles.summary)}>{budgetLine(budget, fix, model, covered)}</p>
    </div>
  );
}

function budgetLine(budget: Budget, fix: Fix, model: string, covered: number): string {
  if (fix.samples === 0) return `No CI fix on ${model} is on record, so nothing prices a try.`;
  const median = `${model}'s median CI fix here costs ${dollars(Number(fix.usd.toFixed(2)))} (${String(fix.samples)} chats)`;

  if (covered === 0)
    return `${median}, more than ${dollars(budget.usd)}: each babysitter stops during its first try.`;

  if (covered < budget.attempts)
    return `${median}: ${dollars(budget.usd)} covers ${String(covered)} of ${tries(budget.attempts)}.`;

  return `${median}: ${tries(budget.attempts)} fit inside ${dollars(budget.usd)}.`;
}

function BriefPreview({
  number,
  preview,
}: {
  readonly number: number;
  readonly preview: Brief;
}): ReactElement {
  const words = preview.lines.reduce((sum, line) => sum + line.length, 0);

  return (
    <div {...props(routineStyles.block)}>
      <div {...props(routineStyles.sectionHeader)}>
        <span {...props(routineStyles.label)}>Preview</span>
        <span {...props(routineStyles.label)}>Babysitter brief for #{number}</span>
      </div>
      <div {...props(routineStyles.brief)}>
        <div {...props(routineStyles.briefText)}>
          {preview.lines.map((line, index) =>
            line.every((word) => word.text === "") ? null : (
              <p
                key={index}
                {...props(routineStyles.line, index === 0 && routineStyles.briefModel)}
              >
                {spans(line).map((run, at) => (
                  <span
                    key={at}
                    {...props(run.changed && intent.primary, run.changed && routineStyles.changed)}
                  >
                    {run.text}
                  </span>
                ))}
              </p>
            ),
          )}
        </div>
        <div {...props(routineStyles.briefFooter)}>
          <span>
            {words} words · to {preview.prompt.to}
          </span>
          <span
            {...props(
              preview.changed > 0 && intent.primary,
              preview.changed > 0 && routineStyles.changed,
            )}
          >
            {preview.changed === 0 ? "same as the lane's" : `${String(preview.changed)} changed`}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Joins neighbouring words that are both changed or both kept into one run of text. */
function spans(line: readonly Word[]): readonly Word[] {
  const starts = line.flatMap((word, index) =>
    index === 0 || line[index - 1]?.changed !== word.changed ? [index] : [],
  );

  return starts.map((start, index) => {
    const words = line.slice(start, starts[index + 1]);

    return {
      text: `${start === 0 ? "" : " "}${words.map((word) => word.text).join(" ")}`,
      changed: words[0]?.changed ?? false,
    };
  });
}

interface Action {
  readonly key: string;
  readonly group: string;
  readonly who: string;
  readonly what: string;
  readonly code: string | null;
}

function DryRun({ tested }: { readonly tested: Backtest }): ReactElement {
  const routed = tested.plan.dispatches.filter(
    (dispatch) => dispatch.decision.kind === "route",
  ).length;

  const all = tested.plan.dispatches.flatMap(describe);

  const actions = all
    .filter((action, index) => all.findIndex((other) => other.group === action.group) === index)
    .map((first) => {
      const more = all.filter((other) => other.group === first.group).length - 1;

      return more === 0 ? first : { ...first, who: `${first.who} +${String(more)}` };
    });

  return (
    <div {...props(routineStyles.block)}>
      <div {...props(routineStyles.sectionHeader)}>
        <span {...props(routineStyles.label)}>What it would do</span>
        <span {...props(routineStyles.label)}>
          {actions.length} {actions.length === 1 ? "action" : "actions"}
          {routed === 0 ? "" : `, ${String(routed)} failures wait on main`}
        </span>
      </div>
      {actions.length === 0 ? (
        <p {...props(routineStyles.summary)}>Nothing: every caught failure waits on main.</p>
      ) : (
        <ul {...props(routineStyles.run)}>
          {actions.map((action) => (
            <li key={action.key} {...props(routineStyles.runItem)}>
              <span {...props(routineStyles.runWho)}>{action.who}</span>
              <span {...props(routineStyles.runWhat)}>
                {action.what}
                {action.code !== null && (
                  <>
                    {" "}
                    <code {...props(routineStyles.runCode)}>{action.code}</code>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function describe(dispatch: Dispatch): readonly Action[] {
  const pull = dispatch.event.pull;
  const at = pull === null ? "Main" : `#${String(pull)}`;

  switch (dispatch.decision.kind) {
    case "ignore":
    case "route":
      return [];
    case "wake":
      return [
        {
          key: dispatch.key,
          group:
            pull === null || dispatch.event.check === null
              ? dispatch.key
              : `wake:${dispatch.event.check.workflow}/${dispatch.event.check.name}:${dispatch.event.check.step ?? ""}`,
          who: pull === null ? "Main" : `#${String(pull)} babysitter`,
          what: dispatch.decision.message,
          code: null,
        },
      ];
    case "remedy":
      return [
        {
          key: dispatch.key,
          group: dispatch.key,
          who: `${at}, no model`,
          what: dispatch.decision.commit,
          code: dispatch.decision.command,
        },
      ];
    case "ask":
      return [
        {
          key: dispatch.key,
          group: dispatch.key,
          who: "You",
          what: dispatch.decision.question,
          code: null,
        },
      ];
    case "stop":
      return dispatch.decision.reason === "merged" || dispatch.decision.reason === "closed"
        ? []
        : [
            {
              key: dispatch.key,
              group: `stop:${dispatch.decision.reason}`,
              who: at,
              what: `Stops: ${dispatch.decision.reason}`,
              code: null,
            },
          ];
    default: {
      const _exhaustive: never = dispatch.decision;

      return _exhaustive;
    }
  }
}
