import { useRef } from "react";
import { motion, useMotionValueEvent, useTransform } from "motion/react";
import type { MotionValue } from "motion/react";
import {
  ErrorIcon,
  ProblemRow,
  Squiggle,
  problemAppears,
  problemFixed,
  problems,
  timeline,
} from "./problems";

const conversations = [
  {
    prompt: "Build me a coding agent.",
    answer: "Connected a model and added file tools.",
    changes: [
      { file: "agent.ts", lines: "+24" },
      { file: "tools.ts", lines: "+38" },
      { file: "chat.tsx", lines: "+56" },
    ],
  },
  {
    prompt: "Ship it to the team.",
    answer: "It can't ship yet. The workspace has 6 problems.",
    changes: [],
  },
  {
    prompt: "Embed @nyte-ai/core.",
    answer: "Fixed 6 problems.",
    changes: [{ file: "host.ts", lines: "+12" }],
  },
] as const;

export function Arrow({ direction }: { direction: "down" | "external" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d={direction === "external" ? "M6 14 14 6M7 6h7v7" : "M10 3v13m-5-5 5 5 5-5"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Editor({
  chapter,
  progress,
  reducedMotion,
}: {
  chapter: number;
  progress: MotionValue<number>;
  reducedMotion: boolean;
}) {
  const panel = useRef<HTMLElement>(null);

  const panelOpen = useTransform(
    progress,
    [0, timeline.problemsOpen, timeline.firstProblem, 1],
    [0, 0, 1, 1],
  );

  useMotionValueEvent(panelOpen, "change", (value) => {
    panel.current?.style.setProperty("--panel-open", String(value));
  });

  const problemCount = useTransform(progress, (value) =>
    String(
      problems.filter(
        (problem) =>
          value >= problemAppears(problem.id) && value < problemFixed(problem.id) + 0.015,
      ).length,
    ),
  );

  const clearOpacity = useTransform(progress, [0, 0.78, 0.8, 1], [0, 0, 1, 1]);
  const conversation = conversations[chapter] ?? conversations[0];

  return (
    <div className="editor-window">
      <div className="window-bar">
        <span className="traffic-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="window-title">my-cursor</span>
      </div>
      <div className="editor-body">
        <div className="code-pane">
          <div className="editor-tab">agent.ts</div>
          <pre className="editor-code" aria-label="A simple coding agent prototype">
            <code>
              <span className="code-line">
                <b>import</b> {"{ streamText }"} <b>from</b> <em>"ai"</em>;
              </span>
              <span className="code-line">
                <b>import</b> {"{ "}
                <Squiggle id="approvals" progress={progress}>
                  tools
                </Squiggle>
                {" }"} <b>from</b> <em>"./tools"</em>;
              </span>
              <span className="code-line"> </span>
              <span className="code-line">
                <b>export async function</b>{" "}
                <strong>
                  <Squiggle id="vcs" progress={progress}>
                    run
                  </Squiggle>
                </strong>
                (prompt) {"{"}
              </span>
              <span className="code-line">
                {"  "}
                <b>const</b> result ={" "}
                <strong>
                  <Squiggle id="sessions" progress={progress}>
                    streamText
                  </Squiggle>
                </strong>
                ({"{"}
              </span>
              <span className="code-line">
                {"    "}model:{" "}
                <em>
                  <Squiggle id="providers" progress={progress}>
                    "your-favorite-model"
                  </Squiggle>
                </em>
                ,
              </span>
              <span className="code-line">
                {"    "}system: <em>"You are a coding agent."</em>,
              </span>
              <span className="code-line">{"    "}prompt,</span>
              <span className="code-line">{"    "}tools,</span>
              <span className="code-line">
                {"  "}
                {"});"}
              </span>
              <span className="code-line"> </span>
              <span className="code-line">
                {"  "}
                <b>return</b> result.textStream;
              </span>
              <span className="code-line">{"}"}</span>
            </code>
          </pre>
          <section ref={panel} className="problems-panel" aria-label="Problems">
            <div className="problems-header">
              Problems
              <motion.span className="problems-count">{problemCount}</motion.span>
            </div>
            <ol className="problems-list">
              {problems.map((problem) => (
                <ProblemRow
                  key={problem.id}
                  problem={problem}
                  progress={progress}
                  reducedMotion={reducedMotion}
                />
              ))}
            </ol>
            <motion.p className="problems-clear" style={{ opacity: clearOpacity }}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle
                  cx="8"
                  cy="8"
                  r="6.25"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="m5.5 8.25 1.75 1.75 3.25-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              No problems in the workspace.
            </motion.p>
          </section>
        </div>
        <div className="agent-pane" key={chapter}>
          <div className="agent-prompt">{conversation.prompt}</div>
          <div className="agent-answer">
            {chapter === 1 ? <ErrorIcon /> : <span className="agent-sparkle">✳</span>}
            <p>{conversation.answer}</p>
          </div>
          {conversation.changes.map((change) => (
            <div className="file-change" key={change.file}>
              <span>{change.file}</span>
              <span>{change.lines}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
