import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { styles } from "./page.stylex";
import type { Scenario, Step } from "./world.ts";

function Clock({ step }: { readonly step: Step }): ReactElement {
  return (
    <span {...props(styles.journeyClock)}>
      {step.estimate ? "≈ " : ""}
      {step.clock}
    </span>
  );
}

export function Journey({
  played,
  others,
  at,
  onStep,
}: {
  readonly played: Scenario;
  readonly others: readonly Scenario[];
  readonly at: number;
  readonly onStep: (index: number) => void;
}): ReactElement {
  return (
    <aside aria-label="Journey" {...props(styles.journey)}>
      <h2 {...props(styles.journeyTitle)}>{played.title}</h2>
      <p {...props(styles.quiet)}>{played.summary}</p>
      <ol {...props(styles.journeySteps)}>
        {played.steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              aria-current={index === at ? "step" : undefined}
              onClick={() => onStep(index)}
              {...props(
                styles.journeyEntry,
                styles.journeyStep,
                index === at && styles.journeyStepCurrent,
                index > at && styles.journeyStepAhead,
              )}
            >
              <span {...props(styles.journeyLabel)}>
                {step.label}
                <Clock step={step} />
              </span>
              <span {...props(styles.journeyCaption)}>{step.caption}</span>
            </button>
          </li>
        ))}
      </ol>
      <h3 {...props(styles.journeyHeading)}>Other journeys</h3>
      <p {...props(styles.quiet)}>Read only. The window plays the journey above.</p>
      {others.map((scenario) => (
        <details key={scenario.id} {...props(styles.details)}>
          <summary {...props(styles.summary)}>{scenario.title}</summary>
          <div {...props(styles.detailsBody, styles.journeyOther)}>
            <p {...props(styles.quiet)}>{scenario.summary}</p>
            <ol {...props(styles.journeySteps)}>
              {scenario.steps.map((step) => (
                <li key={step.id} {...props(styles.journeyEntry)}>
                  <span {...props(styles.journeyLabel)}>
                    {step.label}
                    <Clock step={step} />
                  </span>
                  <span {...props(styles.journeyCaption)}>{step.caption}</span>
                </li>
              ))}
            </ol>
          </div>
        </details>
      ))}
    </aside>
  );
}
