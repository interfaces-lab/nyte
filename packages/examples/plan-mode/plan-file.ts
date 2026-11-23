import { standard } from "@nyte-ai/schema";
import type { Infer } from "@nyte-ai/schema";
import { Type } from "typebox";

export const PLANS_FOLDER = ".nyte/plans";

const TODOS_HEADING = "## To-dos";

const OPEN_TODO = "- [ ] ";

const DONE_TODO = "- [x] ";

const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;

export const planState = standard(
  Type.Object({
    path: Type.String(),
    name: Type.String(),
    overview: Type.String(),
    todos: Type.Array(Type.Object({ content: Type.String(), done: Type.Boolean() })),
    built: Type.Boolean(),
  }),
);

export type PlanState = Infer<typeof planState>;

export const trayState = standard(
  Type.Object({
    card: Type.String(),
    name: Type.String(),
    path: Type.String(),
    todos: Type.Integer({ minimum: 0 }),
    done: Type.Integer({ minimum: 0 }),
  }),
);

export type TrayState = Infer<typeof trayState>;

export type PlanTodo = PlanState["todos"][number];

/** Derives a tray's state from its plan card's id and state. */
export function planTrayState(
  card: string,
  state: Pick<PlanState, "name" | "path" | "todos">,
): TrayState {
  return {
    card,
    name: state.name,
    path: state.path,
    todos: state.todos.length,
    done: state.todos.filter((todo) => todo.done).length,
  };
}

/** The plan as a file: YAML frontmatter, the markdown body, then the to-dos as a task list. */
export function writePlan(plan: {
  readonly name: string;
  readonly overview: string;
  readonly body: string;
  readonly todos: readonly string[];
}): string {
  return [
    "---",
    `name: ${JSON.stringify(plan.name)}`,
    `overview: ${JSON.stringify(plan.overview)}`,
    "---",
    "",
    plan.body.trim(),
    "",
    TODOS_HEADING,
    "",
    ...plan.todos.map((todo) => `${OPEN_TODO}${todo.trim()}`),
    "",
  ].join("\n");
}

/** The to-dos under the plan's `## To-dos` heading, as the user and the agent left them. */
export function readTodos(contents: string): readonly PlanTodo[] {
  const lines = contents.split("\n");
  const start = lines.findIndex((line) => line.trim() === TODOS_HEADING);

  if (start === -1) return [];

  const section = lines.slice(start + 1);
  const end = section.findIndex((line) => line.startsWith("#"));

  return (end === -1 ? section : section.slice(0, end)).flatMap((line): PlanTodo[] => {
    const item = line.trimStart();

    if (item.startsWith(OPEN_TODO)) {
      return [{ content: item.slice(OPEN_TODO.length).trim(), done: false }];
    }

    if (item.toLowerCase().startsWith(DONE_TODO)) {
      return [{ content: item.slice(DONE_TODO.length).trim(), done: true }];
    }

    return [];
  });
}

/** A file name for the plan: its name in lowercase words joined by hyphens, then a short id. */
export function planFileName(name: string, id: string): string {
  const words = name
    .toLowerCase()
    .split(WORD_SEPARATOR)
    .filter((word) => word !== "")
    .slice(0, 8);

  return `${[...words, id].join("-")}.plan.md`;
}
