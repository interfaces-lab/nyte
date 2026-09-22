import { useRef, useState } from "react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { Arrow, Editor } from "./editor";
import { ErrorIcon, problems } from "./problems";
import type { ProblemId } from "./problems";

const chapters = [
  { label: "The idea", progress: 0 },
  { label: "The work", progress: 0.6 },
  { label: "Nyte", progress: 0.92 },
] as const;

const foundations: { title: string; description: string; fixes: ProblemId[] }[] = [
  {
    title: "Versioned turns",
    description:
      "Connect a VCS backend for per-turn file diffs and revert. Conversation branches and history live in core.",
    fixes: ["vcs"],
  },
  {
    title: "The runtime",
    description:
      "Durable sessions, tools, approvals, cancellation, and context compaction. The same core runs inside a desktop app or on a server.",
    fixes: ["sessions", "providers", "approvals"],
  },
  {
    title: "A working reference",
    description:
      "Nyte's desktop and terminal apps use that core. Start with their workbench and components, or write your own client.",
    fixes: ["workbench", "design"],
  },
];

const embedExample = `import { createNyte } from "@nyte-ai/core";

const agent = await createNyte({
  store, model, models,
  streamFn, plugins, env,
});

agent.attach();

const { sessionId } = await agent.sessions.create();
await agent.messages.send({
  sessionId,
  content: "Build me a code editor.",
});`;

export function Antimetal() {
  const story = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion() === true;
  const [chapter, setChapter] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const { scrollYProgress } = useScroll({ target: story, offset: ["start start", "end end"] });

  const ideaOpacity = useTransform(scrollYProgress, [0, 0.06, 0.1, 1], [1, 1, 0, 0]);
  const ideaY = useTransform(scrollYProgress, [0, 0.06, 0.12, 1], [0, 0, -24, -24]);

  const workOpacity = useTransform(
    scrollYProgress,
    [0, 0.1, 0.14, 0.6, 0.64, 1],
    [0, 0, 1, 1, 0, 0],
  );

  const workY = useTransform(
    scrollYProgress,
    [0, 0.1, 0.16, 0.6, 0.66, 1],
    [24, 24, 0, 0, -24, -24],
  );

  const nyteOpacity = useTransform(scrollYProgress, [0, 0.64, 0.68, 1], [0, 0, 1, 1]);
  const nyteY = useTransform(scrollYProgress, [0, 0.64, 0.7, 1], [24, 24, 0, 0]);

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    setChapter(value < 0.1 ? 0 : value < 0.64 ? 1 : 2);
  });

  function goToChapter(progress: number) {
    const element = story.current;

    if (element === null) return;
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: top + (element.offsetHeight - window.innerHeight) * progress,
      behavior: reducedMotion ? "instant" : "smooth",
    });
  }

  return (
    <div className="antimetal-page">
      <a className="skip-link" href="#foundation">
        Skip to Nyte
      </a>
      <main id="top">
        <section ref={story} className="story" aria-label="Building your own coding agent">
          <div className="story-stage">
            <header className="stage-header">
              <a className="wordmark" href="#top">
                nyte
              </a>
              <nav className="chapter-nav" aria-label="Story chapters">
                {chapters.map((item, index) => (
                  <button
                    key={item.label}
                    onClick={() => goToChapter(item.progress)}
                    aria-current={chapter === index ? "step" : undefined}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </header>

            <div className="stage-body">
              <div className="stage-copy">
                <motion.div
                  className="act"
                  style={{ opacity: ideaOpacity, y: reducedMotion ? 0 : ideaY }}
                  aria-hidden={chapter !== 0}
                  inert={chapter !== 0}
                >
                  <h1>By now, everybody can build their own Cursor.</h1>
                  <button className="primary-button" onClick={() => goToChapter(0.26)}>
                    Start building <Arrow direction="down" />
                  </button>
                </motion.div>

                <motion.div
                  className="act"
                  style={{ opacity: workOpacity, y: reducedMotion ? 0 : workY }}
                  aria-hidden={chapter !== 1}
                >
                  <h2>Until you start building it.</h2>
                </motion.div>

                <motion.div
                  className="act"
                  style={{ opacity: nyteOpacity, y: reducedMotion ? 0 : nyteY }}
                  aria-hidden={chapter !== 2}
                  inert={chapter !== 2}
                >
                  <h2>Embed Nyte. Build your Cursor.</h2>
                  <p>
                    An agent core you can embed in your app. Sessions, tools, and turn history
                    included.
                  </p>
                  <a className="primary-button" href="#foundation">
                    See the core <Arrow direction="down" />
                  </a>
                </motion.div>
              </div>

              <div className="editor-position" aria-hidden="true" inert>
                <Editor
                  chapter={chapter}
                  progress={scrollYProgress}
                  reducedMotion={reducedMotion}
                />
              </div>
            </div>

            <div className="story-progress" aria-hidden="true">
              <motion.div style={{ scaleX: scrollYProgress }} />
            </div>
          </div>
        </section>

        <section className="foundation" id="foundation">
          <div className="foundation-intro">
            <h2>One core. Your application.</h2>
            <p>
              Supply your storage, models, and plugins. Build your interface on the same SDK we use.
            </p>
          </div>
          <ul className="foundation-rows">
            {foundations.map((item) => (
              <li key={item.title}>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
                <ul className="fixed-problems">
                  {problems
                    .filter((problem) => item.fixes.includes(problem.id))
                    .map((problem) => (
                      <li key={problem.id}>
                        <ErrorIcon />
                        <s>{problem.message}</s>
                        <s>{problem.cost}</s>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="embed-example">
            <div className="example-toolbar">
              <span>host.ts</span>
              <button
                className="copy-example"
                aria-live="polite"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(embedExample);
                    setCopyState("copied");
                  } catch {
                    setCopyState("failed");
                  }
                }}
              >
                {copyState === "copied" ? "Copied" : "Copy code"}
              </button>
            </div>
            <pre tabIndex={0} aria-label="Nyte core embedding example">
              <code>{embedExample}</code>
            </pre>
            <span className="copy-feedback" role="status">
              {copyState === "failed" ? "Select the code to copy it." : ""}
            </span>
          </div>
          <footer className="site-footer">
            <a className="wordmark" href="#top">
              nyte
            </a>
            <a href="https://github.com/interfaces-lab/nyte/blob/main/packages/docs/content/docs/sdk.mdx">
              SDK docs <Arrow direction="external" />
            </a>
            <a href="https://github.com/interfaces-lab/nyte">
              Source <Arrow direction="external" />
            </a>
          </footer>
        </section>
      </main>
    </div>
  );
}
