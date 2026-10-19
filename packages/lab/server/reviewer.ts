/**
 * The two roles the lab's core sessions play, chosen by the session's name.
 *
 * The reviewer runs every head of a review session: one system prompt and
 * four tools, the same for a brief written from the patch, a brief cut from an
 * earlier one, and the questions cut from either. A head that changed any of
 * them would declare a new system message and lose the cached prefix it was
 * cut to share, so a review session is named for this reviewer's version. Its
 * tools only read: files, patches and `git grep` at commits of the repository.
 * `publish_guide` refuses a guide the Review page cannot draw, so the model
 * corrects itself instead of the page bending.
 *
 * The author is Nyte coding on the review's branch: the product's file and
 * shell tools, acting in a worktree that has only that branch checked out, so
 * nothing it does reaches your checkout.
 */
import { createHash } from "node:crypto";
import type { ToolDefinition } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/plugin/core";
import { standard } from "@nyte-ai/schema";
import { Type, type Static } from "typebox";
import { GuideSchema, type GuideSection } from "../src/review/wire.ts";
import type { Repo } from "./git.ts";
import type { Registry } from "./registry.ts";

const MAX_WORDS = 60;

const READ_LINES = 400;

const PATCH_CHARS = 60_000;

const SEARCH_LINES = 80;

const PROMPT = `You are Nyte's code reviewer. You help one person review one change to a git repository: you explain it and answer questions about it; you never change code.

The first message names the change: its base and head commits, its commits, its changed files and, when it is small enough, its patch. Your tools read the repository at any commit:
- diff_file: one file's patch between two commits.
- read_file: a file at a commit, with line numbers, for the code around a change.
- search: git grep at a commit, for definitions and callers.
Read what you need to explain the change correctly. Do not read every file of a large change.

When asked for the guide, call publish_guide once with the complete guide for the named head:
- One section per part of the change, in the order a reviewer should read them: the core of the change first, then what uses it, then tests, docs and configuration.
- Every changed file belongs to exactly one section. A path ending in / stands for every changed file under that directory; use it for groups of related files, and never let it overlap a path another section names.
- title: what the part does, in at most 6 words.
- explanation: one or two plain sentences, at most ${MAX_WORDS} words. Say what the part does, then what follows from it that a reviewer must check. Name functions as written, like start() or refresh(). No Markdown.
After publishing, reply with one short sentence.

When asked a question, answer in short prose with path:line references at the head commit, reading code when you need to. Do not call publish_guide.`;

/** Sessions named with this prefix code; every other session reviews. */
export const AUTHOR_PREFIX = "author ";

export const REVIEW_AGENT = "lab-reviewer";

export const AUTHOR_AGENT = "lab-author";

export const DIRECTOR_AGENT = "lab-director";

const DIRECTOR_PROMPT = `You direct Nyte's launch film in the lab's studio, which works like After Effects: a Project panel of compositions, footage, fonts and sources; a viewer playing the open composition in Remotion; a timeline of its layers and markers. Every file you save hot-reloads the viewer within a second, and the same files render the film.

Your working directory is the root of the Nyte repository, so you can read the app, packages and docs the film is built from. The film's project lives in packages/lab/video/, and the paths below are relative to it:
- src/project.ts: the manifest the studio reads. It lists the compositions (nyte, the 60-second film; ending, the closing shot, a precomp of the film from its dawn beat, frame 1505), the footage under public/, the fonts and the sources.
- src/film/film.tsx: the film: the opening strip, the app window and its camera, captions, sound. It exports \`layers\`, \`captions\`, \`effects\` and \`score\`.
- src/film/ending.tsx: the closing shot. It exports \`layers\`, \`markers\`, \`length\` and \`Ending\`; its frame 0 is the film's dawn.
- src/film/timeline.ts: the beats every scene is cued from, which the film's markers show.
- src/film/chat.ts and window.tsx: the session the window shows and the window, built from the app's real React components under packages/app/src. Keep them real; never replace them with drawings.
- src/film/dither.tsx and type.tsx: the dithered sky, moon and palette; kinetic type, fonts and easing.
- public/: generated footage. You cannot make new audio; reuse what is there.

Skills: read a skill's file when its description matches the task.
- remotion-best-practices: Router for all Remotion skills: markup, animation, captions, multimedia, interactivity, rendering and the Studio. Read it before you write Remotion code you are unsure of, then the reference it points to. (packages/lab/video/skills/remotion-best-practices/SKILL.md)

Each message starts with what the user is looking at, like "[ending · frame 96 · 3.20 s · film frame 1601 · layer "Nyte"]". Read it as "here".

Rules:
- Animate only from the frame: useCurrentFrame(), interpolate(), spring(), or the progress() helper. No CSS animations or transitions, no timers, no Date, no randomness without a fixed seed. The film renders frame by frame.
- 1920×1080, 30 fps. Keep every \`layers\` and \`markers\` entry true to what the composition draws; update them when you move or add a beat, so the timeline stays honest.
- Make the smallest change that does what they asked. Read the file first, then use edit with exact text; rewrite a file only when most of it changes.
- Keep the film compiling. If you are unsure an API exists, read the file that defines it.
- The studio is already running and previews every save. Never start Remotion Studio, a dev server or a render.
- Reply in one or two plain sentences: what changed and at which frames. No code blocks unless asked.`;

const AUTHOR_PROMPT = `You are Nyte, a coding agent working on one branch of this repository. Your working directory is a git worktree with only that branch checked out. Someone reviews the branch as a pull request and asks you for work on it.

- Read AGENTS.md in your working directory first and follow it.
- Do what the request asks and nothing more.
- Dependencies are not installed in your worktree. Before a check that needs them, run pnpm install --frozen-lockfile --offline once; skip checks that would take minutes.
- Commit on the current branch with a conventional subject, type(scope): summary. A request ends in a commit, or in a short reply saying why nothing changed.
- Never push, switch branches, rewrite history, or touch anything outside your working directory.
- When you finish, reply in one or two sentences: what changed and the commit it is in.`;

const READ_DESCRIPTION = "Read a file at a commit, with line numbers.";

const DIFF_DESCRIPTION = "Show one file's patch between two commits.";

const SEARCH_DESCRIPTION = "Search the repository at a commit with git grep (extended regex).";

const PUBLISH_DESCRIPTION =
  "Publish the review guide for the change between base and head. Call it once per guide request.";

const readParameters = Type.Object({
  revision: Type.String({ description: "Commit id to read at." }),
  path: Type.String({ description: "Repository-relative file path." }),
  offset: Type.Optional(Type.Integer({ minimum: 1, description: "First line, 1-based." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
});

const diffParameters = Type.Object({
  from: Type.String({ description: "Commit id of the old side." }),
  to: Type.String({ description: "Commit id of the new side." }),
  path: Type.String({ description: "Repository-relative file path." }),
});

const searchParameters = Type.Object({
  revision: Type.String({ description: "Commit id to search at." }),
  pattern: Type.String({ description: "Extended regular expression." }),
  path: Type.Optional(Type.String({ description: "Limit to this file or directory." })),
});

/**
 * Names what this reviewer declares. A review session is named for it, so a
 * changed prompt or tool starts new sessions instead of breaking the cache of
 * the old ones.
 */
export const REVIEWER_VERSION = createHash("sha256")
  .update(
    JSON.stringify([
      PROMPT,
      [READ_DESCRIPTION, readParameters],
      [DIFF_DESCRIPTION, diffParameters],
      [SEARCH_DESCRIPTION, searchParameters],
      [PUBLISH_DESCRIPTION, GuideSchema],
    ]),
  )
  .digest("hex")
  .slice(0, 8);

const covers = (entry: string, path: string): boolean =>
  entry.endsWith("/") ? path.startsWith(entry) : entry === path;

/** Every reason the page could not draw this guide over these changed files. */
function guideProblems(
  sections: readonly GuideSection[],
  changed: readonly string[],
): readonly string[] {
  const entries = sections.flatMap((section) => section.paths);
  const unknown = entries.filter((entry) => !changed.some((path) => covers(entry, path)));
  const missing = changed.filter((path) => !entries.some((entry) => covers(entry, path)));

  const repeated = changed.filter(
    (path) => entries.filter((entry) => covers(entry, path)).length > 1,
  );

  const long = sections.filter((section) => section.explanation.split(/\s+/).length > MAX_WORDS);

  const marked = sections.filter((section) =>
    /`|\*\*|^#|\n- /m.test(`${section.title}\n${section.explanation}`),
  );

  const problems: string[] = [];

  if (unknown.length > 0) problems.push(`These name no changed file: ${unknown.join(", ")}`);

  if (missing.length > 0)
    problems.push(
      `Every changed file needs a section. Missing: ${missing.slice(0, 40).join(", ")}`,
    );

  if (repeated.length > 0)
    problems.push(
      `Each changed file belongs to exactly one section; these match more than one entry: ${repeated.slice(0, 40).join(", ")}`,
    );

  if (long.length > 0)
    problems.push(
      `Keep each explanation to ${MAX_WORDS} words: ${long.map((section) => section.title).join(", ")}`,
    );

  if (marked.length > 0)
    problems.push(
      `Write plain sentences without Markdown: ${marked.map((section) => section.title).join(", ")}`,
    );

  return problems;
}

function numbered(text: string, offset: number, limit: number): string {
  const lines = text.replace(/\n$/, "").split("\n");
  const end = Math.min(lines.length, offset - 1 + limit);
  const width = String(end).length;

  const shown = lines
    .slice(offset - 1, end)
    .map((line, index) => `${String(offset + index).padStart(width)}\t${line}`);

  const rest = lines.length - end;

  return rest > 0
    ? `${shown.join("\n")}\n… ${rest} more lines; read from line ${end + 1}.`
    : shown.join("\n");
}

function reviewTools(deps: { readonly repo: Repo; readonly registry: Registry }) {
  const commit = async (revision: string): Promise<string> => {
    const oid = await deps.repo.resolve(revision);

    if (oid === undefined) throw new Error(`${revision} is not a commit of this repository`);

    return oid;
  };

  const read: ToolDefinition<Static<typeof readParameters>> = {
    name: "read_file",
    description: READ_DESCRIPTION,
    parameters: standard(readParameters),
    effects: "none",
    replay: "safe",
    class: (args) => ({ kind: "read", path: args.path }),
    execute: async (input) => {
      const text = await deps.repo.show(await commit(input.revision), input.path);

      if (text === undefined) throw new Error(`${input.path} does not exist at ${input.revision}`);

      return {
        content: [
          { kind: "text", text: numbered(text, input.offset ?? 1, input.limit ?? READ_LINES) },
        ],
      };
    },
  };

  const diff: ToolDefinition<Static<typeof diffParameters>> = {
    name: "diff_file",
    description: DIFF_DESCRIPTION,
    parameters: standard(diffParameters),
    effects: "none",
    replay: "safe",
    class: () => ({ kind: "custom", label: "Diff" }),
    execute: async (input) => {
      const patch = await deps.repo.patch(await commit(input.from), await commit(input.to), [
        input.path,
      ]);

      const text =
        patch === ""
          ? `${input.path} is the same at both commits.`
          : patch.length > PATCH_CHARS
            ? `${patch.slice(0, PATCH_CHARS)}\n… the patch continues for ${patch.length - PATCH_CHARS} more characters; read the new side with read_file.`
            : patch;

      return { content: [{ kind: "text", text }] };
    },
  };

  const search: ToolDefinition<Static<typeof searchParameters>> = {
    name: "search",
    description: SEARCH_DESCRIPTION,
    parameters: standard(searchParameters),
    effects: "none",
    replay: "safe",
    class: () => ({ kind: "custom", label: "Search" }),
    execute: async (input) => {
      const lines = await deps.repo.grep(
        await commit(input.revision),
        input.pattern,
        input.path,
        SEARCH_LINES,
      );

      return {
        content: [
          {
            kind: "text",
            text: lines.length === 0 ? "No matches." : lines.join("\n"),
          },
        ],
      };
    },
  };

  const publish: ToolDefinition<Static<typeof GuideSchema>, Static<typeof GuideSchema>> = {
    name: "publish_guide",
    description: PUBLISH_DESCRIPTION,
    parameters: standard(GuideSchema),
    effects: "none",
    replay: "safe",
    output: standard(GuideSchema),
    class: () => ({ kind: "custom", label: "Guide" }),
    execute: async (input) => {
      if (!deps.registry.knows(input.base, input.head))
        throw new Error(
          `${input.base}..${input.head} is not a change under review. Use the base and head the message names.`,
        );

      const changed = (await deps.repo.changes(input.base, input.head)).map(
        (change) => change.path,
      );

      const problems = guideProblems(input.sections, changed);

      if (problems.length > 0) throw new Error(problems.join("\n"));

      return {
        content: [
          {
            kind: "text",
            text: `Published ${input.sections.length} sections covering ${changed.length} files.`,
          },
        ],
        output: input,
      };
    },
  };

  return [read, diff, search, publish];
}

export function labPlugins(deps: {
  readonly repo: Repo;
  readonly registry: Registry;
}): readonly Plugin[] {
  return [
    {
      id: "lab-roles",
      contribute: {
        tools: reviewTools(deps),
        agents: [
          {
            id: REVIEW_AGENT,
            prompt: { kind: "replace", text: PROMPT },
            tools: ["read_file", "diff_file", "search", "publish_guide"],
          },
          {
            id: AUTHOR_AGENT,
            prompt: { kind: "replace", text: AUTHOR_PROMPT },
            tools: ["read", "write", "edit", "list", "bash"],
          },
          {
            id: DIRECTOR_AGENT,
            prompt: { kind: "replace", text: DIRECTOR_PROMPT },
            tools: ["read", "write", "edit", "list", "bash"],
          },
        ],
      },
    } satisfies Plugin,
  ];
}
