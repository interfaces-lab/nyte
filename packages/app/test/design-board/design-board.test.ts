import { readFileSync } from "node:fs";
import type { Keyboard } from "@playwright/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spanKey, textDigest } from "@nyte-ai/plugin/design/board-protocol";
import type {
  BoardMessage,
  PageState,
  SheetError,
  Span,
} from "@nyte-ai/plugin/design/board-protocol";
import { openBoardSuite, SKIP_VARIABLE, VIEWPORT } from "./open-board.ts";
import type { BoardSuite, OpenBoard } from "./open-board.ts";

const read = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

const MENU = read("menu.jsx");

const NOTES = read("notes.jsx");

const NOTES_SECOND = read("notes-second.jsx");

const BROKEN = read("broken.jsx");

const SITE = read("site.jsx");

function findSpan(input: {
  readonly path: string;
  readonly text: string;
  readonly open: string;
  readonly inside: string;
  readonly close: string;
}): Span {
  const start = input.text.lastIndexOf(input.open, input.text.indexOf(input.inside));

  return {
    path: input.path,
    start,
    end: input.text.indexOf(input.close, start) + input.close.length,
  };
}

const MENU_FRAME = findSpan({
  path: "design/menu.jsx",
  text: MENU,
  open: "<section",
  inside: 'data-frame="Menu"',
  close: "</section>",
});

const SPECIALS_FRAME = findSpan({
  path: "design/menu.jsx",
  text: MENU,
  open: "<section",
  inside: 'data-frame="Specials"',
  close: "</section>",
});

const TITLE = findSpan({
  path: "design/menu.jsx",
  text: MENU,
  open: "<h1",
  inside: "Tonight",
  close: "</h1>",
});

const NOTES_FRAME = findSpan({
  path: "design/notes.jsx",
  text: NOTES,
  open: "<article",
  inside: 'data-frame="Notes"',
  close: "</article>",
});

const SITE_FRAME = findSpan({
  path: "design/site.jsx",
  text: SITE,
  open: "<div",
  inside: 'data-frame="Site"',
  close: "/>",
});

const NO_PROBLEMS = { pageErrors: [], unreadable: [], policyViolations: [] };

const DRAG = { x: 120, y: 60 };

const label = (open: OpenBoard, name: string) =>
  open.board.locator(`[data-label][data-name="${name}"]`);

const design = (open: OpenBoard, name: string) => open.board.locator(`[data-frame="${name}"]`);

const title = (open: OpenBoard) => open.board.locator(`[data-src="${spanKey(TITLE)}"]`);

const statuses = (open: OpenBoard) =>
  open.board.locator('[data-ring="you"] [role="status"]').allTextContents();

const edits = (posts: readonly BoardMessage[]): readonly BoardMessage[] =>
  posts.filter((message) => message.kind === "move" || message.kind === "text");

async function rectangle(open: OpenBoard, name: string) {
  const box = await design(open, name).boundingBox();

  if (box === null) throw new Error(`The ${name} frame is not on screen.`);

  return box;
}

async function draw(
  open: OpenBoard,
  files: Readonly<Record<string, string>>,
): Promise<Extract<BoardMessage, { kind: "drawn" }>> {
  const since = await open.mark();
  const build = await open.load(files);

  return open.waitForPost("drawn", { build }, since);
}

async function visibleWords(open: OpenBoard, words: readonly string[]): Promise<string[]> {
  const shown = await Promise.all(
    words.map((text) => open.board.getByText(text, { exact: true }).isVisible()),
  );

  return words.filter((_text, index) => shown[index]);
}

async function pressLabel(open: OpenBoard, name: string): Promise<{ x: number; y: number }> {
  const box = await label(open, name).boundingBox();

  if (box === null) throw new Error(`The ${name} label is not on screen.`);
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await open.page.mouse.move(at.x, at.y);
  await open.page.mouse.down();

  return at;
}

async function dragMenu(open: OpenBoard): Promise<void> {
  const at = await pressLabel(open, "Menu");
  await open.page.mouse.move(at.x + DRAG.x, at.y + DRAG.y, { steps: 12 });
  await open.page.mouse.up();
}

async function retypeTitle(open: OpenBoard): Promise<void> {
  await open.board.getByText("Tonight", { exact: true }).dblclick();
  await open.page.keyboard.type("Late supper");
  await open.page.keyboard.press("Enter");
}

async function menuFromSpecials(open: OpenBoard): Promise<string> {
  const menu = await rectangle(open, "Menu");
  const specials = await rectangle(open, "Specials");

  return `${String(Math.round(menu.x - specials.x))} ${String(Math.round(menu.y - specials.y))}`;
}

interface Drag {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly wheel: number | null;
  readonly zoom: number;
  readonly frame: string;
  readonly place: string;
  readonly move: BoardMessage;
}

const DRAGS: readonly Drag[] = [
  {
    name: "at 100% on the first sheet",
    files: { "design/menu.jsx": MENU },
    wheel: null,
    zoom: 1,
    frame: "Menu",
    place: "160, 84",
    move: { kind: "move", key: MENU_FRAME, base: textDigest(MENU), x: 160, y: 84 },
  },
  {
    name: "at 50% on the second sheet",
    files: { "design/menu.jsx": MENU, "design/notes.jsx": NOTES },
    wheel: 100 * Math.LN2,
    zoom: 0.5,
    frame: "Notes",
    place: "240, 120",
    move: { kind: "move", key: NOTES_FRAME, base: textDigest(NOTES), x: 240, y: 120 },
  },
];

const skipped = process.env[SKIP_VARIABLE] === "1";

const SKIPPED = `${SKIP_VARIABLE}=1 is set, so the design board suite is skipped`;

let suite: BoardSuite | undefined;

const opened = (): Promise<OpenBoard> => {
  if (suite === undefined) throw new Error("The board suite did not start.");

  return suite.open();
};

describe("the design board in headless Chromium", () => {
  beforeAll(async () => {
    if (skipped) console.warn(SKIPPED);
    else suite = await openBoardSuite();
  }, 180_000);

  beforeEach((context) => {
    if (skipped) context.skip(SKIPPED);
  });

  afterAll(() => suite?.close());

  it("draws every frame of the fixtures with its label and content and echoes the build in drawn", async () => {
    await using open = await opened();
    const since = await open.mark();

    const build = await open.load({
      "design/menu.jsx": MENU,
      "design/notes.jsx": NOTES,
      "design/site.jsx": SITE,
    });

    const drawn = await open.waitForPost("drawn", {}, since);

    const frames = [
      { name: "Menu", sheet: "design/menu.jsx", shows: "Tonight" },
      { name: "Specials", sheet: "design/menu.jsx", shows: "Soup of the day" },
      { name: "Notes", sheet: "design/notes.jsx", shows: "First draft" },
      { name: "Site", sheet: "design/site.jsx", shows: "example.com/" },
    ];

    for (const frame of frames) await label(open, frame.name).waitFor({ state: "visible" });

    const drawnFrames = await Promise.all(
      frames.map(async (frame) => {
        const box = open.board.locator(`[data-frame-box][data-sheet="${frame.sheet}"]`, {
          has: open.board.locator(`[data-name="${frame.name}"]`),
        });

        const cover = box.locator("[data-page-cover]");
        const content = design(open, frame.name).getByText(frame.shows, { exact: true });
        const covered = (await cover.count()) > 0;
        const marker = covered ? cover : content;

        return {
          name: await label(open, frame.name).textContent(),
          sheet: frame.sheet,
          shows: (await marker.isVisible()) ? await marker.textContent() : null,
        };
      }),
    );

    expect(drawnFrames).toEqual(frames);
    expect(drawn).toEqual({
      kind: "drawn",
      build,
      sheets: [
        { path: "design/menu.jsx", error: null },
        { path: "design/notes.jsx", error: null },
        { path: "design/site.jsx", error: null },
      ],
    });
    expect(await open.problems()).toEqual(NO_PROBLEMS);
  });

  it.each(DRAGS)(
    "a drag $name previews while held and posts one move on release, in board units against its file",
    async (row) => {
      await using open = await opened();
      await draw(open, row.files);
      await open.waitForPost("zoom", { zoom: 1 }, 0);

      if (row.wheel !== null) {
        const zoomed = await open.mark();

        await open.send({
          kind: "wheel",
          x: VIEWPORT.width / 2,
          y: VIEWPORT.height / 2,
          deltaX: 0,
          deltaY: row.wheel,
          zoom: true,
        });
        await open.waitForPost("zoom", { zoom: row.zoom }, zoomed);
      }

      const before = await rectangle(open, row.frame);
      const since = await open.mark();
      const at = await pressLabel(open, row.frame);
      await open.page.mouse.move(at.x + DRAG.x, at.y + DRAG.y, { steps: 12 });
      await open.board.locator("[data-place]").getByText(row.place, { exact: true }).waitFor();
      const held = await rectangle(open, row.frame);

      expect({ x: Math.round(held.x - before.x), y: Math.round(held.y - before.y) }).toEqual(DRAG);
      expect(edits(await open.settlePastEditTimersUntilQuiet(since))).toEqual([]);

      await open.page.mouse.up();

      expect(edits(await open.settlePastEditTimersUntilQuiet(since))).toEqual([row.move]);
      expect(await rectangle(open, row.frame)).toEqual(held);
      expect(await open.problems()).toEqual(NO_PROBLEMS);
    },
  );

  it.each([
    {
      name: "Enter posts the new words once",
      typing: (keyboard: Keyboard) => keyboard.type("Late supper"),
      end: "Enter",
      posts: [{ kind: "text", key: TITLE, base: textDigest(MENU), value: "Late supper" }],
      shows: "Late supper",
      refusals: [],
    },
    {
      name: "Escape posts nothing and puts the words back",
      typing: (keyboard: Keyboard) => keyboard.type("Late supper"),
      end: "Escape",
      posts: [],
      shows: "Tonight",
      refusals: [],
    },
    {
      name: "a 600 ms pause posts the new words once",
      typing: (keyboard: Keyboard) => keyboard.type("Late supper"),
      end: "pause",
      posts: [{ kind: "text", key: TITLE, base: textDigest(MENU), value: "Late supper" }],
      shows: "Late supper",
      refusals: [],
    },
    {
      name: "exactly 4,096 characters posts them",
      typing: (keyboard: Keyboard) => keyboard.insertText("a".repeat(4096)),
      end: "Enter",
      posts: [{ kind: "text", key: TITLE, base: textDigest(MENU), value: "a".repeat(4096) }],
      shows: "a".repeat(4096),
      refusals: [],
    },
    {
      name: "more than 4,096 characters posts nothing and shows the refusal",
      typing: (keyboard: Keyboard) => keyboard.insertText("a".repeat(4097)),
      end: "Enter",
      posts: [],
      shows: "Tonight",
      refusals: ["Too long to save"],
    },
  ] satisfies readonly {
    name: string;
    typing: (keyboard: Keyboard) => Promise<void>;
    end: "Enter" | "Escape" | "pause";
    posts: readonly BoardMessage[];
    shows: string;
    refusals: readonly string[];
  }[])("typing over literal words: $name", async (row) => {
    await using open = await opened();
    await draw(open, { "design/menu.jsx": MENU });
    const since = await open.mark();
    await open.board.getByText("Tonight", { exact: true }).dblclick();
    await open.board
      .locator(`[data-src="${spanKey(TITLE)}"][contenteditable="plaintext-only"]`)
      .waitFor();
    await row.typing(open.page.keyboard);

    if (row.end === "pause") {
      await open.advance(599);

      expect(await title(open).getAttribute("contenteditable")).toBe("plaintext-only");

      await open.advance(2);
    } else await open.page.keyboard.press(row.end);

    expect(await title(open).getAttribute("contenteditable")).toBeNull();

    await open.board.locator('[data-ring="edit"]').waitFor({ state: "detached" });

    for (const refusal of row.refusals) {
      await open.board.locator('[data-ring="you"] [role="status"]').getByText(refusal).waitFor();
    }

    expect(await statuses(open)).toEqual(row.refusals);
    expect(await title(open).textContent()).toBe(row.shows);
    expect(edits(await open.settlePastEditTimersUntilQuiet(since))).toEqual(row.posts);
    expect(await open.problems()).toEqual(NO_PROBLEMS);
  });

  it.each([
    {
      name: "a move puts the frame back where it was drawn",
      gesture: dragMenu,
      edit: "move",
      read: menuFromSpecials,
      before: "-320 0",
      preview: "-200 60",
    },
    {
      name: "a text puts the words back",
      gesture: retypeTitle,
      edit: "text",
      read: (open: OpenBoard) => title(open).evaluate((node) => node.textContent),
      before: "Tonight",
      preview: "Late supper",
    },
  ] satisfies readonly {
    name: string;
    gesture: (open: OpenBoard) => Promise<void>;
    edit: "move" | "text";
    read: (open: OpenBoard) => Promise<string | null>;
    before: string;
    preview: string;
  }[])("a refused edit: $name and shows the refusal on its selection", async (row) => {
    await using open = await opened();
    await draw(open, { "design/menu.jsx": MENU });
    await open.waitForPost("zoom", { zoom: 1 }, 0);

    expect(await row.read(open)).toBe(row.before);

    const since = await open.mark();
    await row.gesture(open);
    const edit = await open.waitForPost(row.edit, {}, since);

    expect(await row.read(open)).toBe(row.preview);

    await open.send({ kind: "refused", from: SPECIALS_FRAME, reason: "changed" });
    await open.handledAndRendered();

    expect(await row.read(open)).toBe(row.preview);
    expect(await open.board.getByRole("status").allTextContents()).toEqual([]);

    await open.send({ kind: "refused", from: edit.key, reason: "changed" });
    await open.board.locator('[data-ring="you"] [role="status"]').waitFor();

    expect(await statuses(open)).toEqual(["File changed, try again"]);
    expect(await row.read(open)).toBe(row.before);
    expect(await open.problems()).toEqual(NO_PROBLEMS);
  });

  it.each([
    {
      name: "throws when evaluated",
      text: read("notes-throws-on-load.jsx"),
      error: {
        message: "Notes broke while loading",
        path: "design/notes.jsx",
        line: 3,
        column: 25,
      },
    },
    {
      name: "throws while drawing",
      text: read("notes-throws-on-draw.jsx"),
      error: {
        message: "Notes broke while drawing",
        path: "design/notes.jsx",
        line: 4,
        column: 27,
      },
    },
    {
      name: "does not compile",
      text: read("notes-unclosed.jsx.txt"),
      error: {
        message: "Unterminated JSX contents",
        path: "design/notes.jsx",
        line: 10,
        column: 15,
      },
    },
  ] satisfies readonly { name: string; text: string; error: SheetError }[])(
    "one bad file fails alone, and a file that $name keeps its last good frames",
    async (row) => {
      await using open = await opened();
      const files = { "design/broken.jsx": BROKEN, "design/menu.jsx": MENU };

      const broken = {
        path: "design/broken.jsx",
        error: {
          message: "Broken on purpose",
          path: "design/broken.jsx",
          line: 3,
          column: 28,
        },
      };

      const healthy = ["Tonight", "Three courses, one table.", "Soup of the day"];
      const first = await draw(open, { ...files, "design/notes.jsx": NOTES });

      expect(first.sheets).toEqual([
        broken,
        { path: "design/menu.jsx", error: null },
        { path: "design/notes.jsx", error: null },
      ]);
      expect(await visibleWords(open, [...healthy, "First draft"])).toEqual([
        ...healthy,
        "First draft",
      ]);
      expect(await open.board.getByRole("alert").allTextContents()).toEqual([
        "design/broken.jsx could not be drawn.\nBroken on purpose (design/broken.jsx:3:28)",
      ]);

      const good = await draw(open, { ...files, "design/notes.jsx": NOTES_SECOND });

      expect(good.sheets).toEqual(first.sheets);
      expect(await visibleWords(open, [...healthy, "Second draft"])).toEqual([
        ...healthy,
        "Second draft",
      ]);

      const bad = await draw(open, { ...files, "design/notes.jsx": row.text });

      expect(bad.sheets).toEqual([
        broken,
        { path: "design/menu.jsx", error: null },
        { path: "design/notes.jsx", error: row.error },
      ]);
      expect(await visibleWords(open, [...healthy, "Second draft"])).toEqual([
        ...healthy,
        "Second draft",
      ]);

      await label(open, "Notes").locator("[data-error]").waitFor();

      expect(await label(open, "Notes").locator("[data-error]").textContent()).toBe(
        `${row.error.message} (design/notes.jsx:${String(row.error.line)}:${String(row.error.column)})`,
      );
      expect(await open.problems()).toEqual(NO_PROBLEMS);
    },
  );

  it("reports a page frame still, live, entered and live again, at the frame's box after a pan and at 50%", async () => {
    await using open = await opened();
    await draw(open, { "design/site.jsx": SITE });

    const measure = () =>
      design(open, "Site").evaluate((node) => {
        const box = node.getBoundingClientRect();

        return { x: box.x, y: box.y, width: box.width, height: box.height, scale: box.width / 320 };
      });

    const box = (message: Extract<BoardMessage, { kind: "pages" }>) =>
      message.pages.map((page) => ({
        x: page.x,
        y: page.y,
        width: page.width,
        height: page.height,
        scale: page.scale,
      }));

    const lastReport = async (since: number) => {
      const reports = (await open.settlePastEditTimersUntilQuiet(since)).flatMap((message) =>
        message.kind === "pages" ? [message] : [],
      );

      const last = reports.at(-1);

      if (last === undefined) throw new Error("The board reported no page frames.");

      return last;
    };

    const reach = async (state: PageState, act: () => Promise<void>) => {
      const since = await open.mark();
      await act();
      await open.board.locator(`[data-frame-box][data-page-state="${state}"]`).waitFor();
      const report = await lastReport(since);

      expect(report.pages.map((page) => page.state)).toEqual([state]);

      return report;
    };

    expect(box(await lastReport(0))).toEqual([await measure()]);

    await reach("live", () => label(open, "Site").click());
    await reach("entered", () => design(open, "Site").dblclick());
    const live = await reach("live", () => open.send({ kind: "leave" }));

    const panned = await reach("live", () =>
      open.send({ kind: "wheel", x: 0, y: 0, deltaX: 40, deltaY: 30, zoom: false }),
    );

    const moved = await measure();

    expect(box(panned)).toEqual([moved]);
    expect(box(live).map((page) => ({ x: page.x - moved.x, y: page.y - moved.y }))).toEqual([
      { x: 40, y: 30 },
    ]);

    const zoomed = await reach("live", () =>
      open.send({
        kind: "wheel",
        x: VIEWPORT.width / 2,
        y: VIEWPORT.height / 2,
        deltaX: 0,
        deltaY: 100 * Math.LN2,
        zoom: true,
      }),
    );

    expect(box(zoomed)).toEqual([await measure()]);
    expect(box(zoomed).map((page) => [page.width, page.height, page.scale])).toEqual([
      [160, 100, 0.5],
    ]);

    const reports = (await open.settlePastEditTimersUntilQuiet(0)).flatMap((message) =>
      message.kind === "pages" ? message.pages : [],
    );

    const states = reports.map((page) => page.state);

    expect(states.filter((state, index) => state !== states[index - 1])).toEqual([
      "still",
      "live",
      "entered",
      "live",
    ]);
    expect(reports.map((page) => [page.key, page.url])).toEqual(
      reports.map(() => [SITE_FRAME, "https://example.com/"]),
    );
    expect(await open.problems()).toEqual(NO_PROBLEMS);
  });

  it("blocks an inline script in the board document", async () => {
    await using open = await opened();
    await draw(open, { "design/menu.jsx": MENU });

    const reported = open.page.waitForEvent("console", (message) =>
      message.text().includes("Content Security Policy"),
    );

    const outcome = await open.frame.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener(
            "securitypolicyviolation",
            (event) => resolve(`blocked by ${event.effectiveDirective}`),
            { once: true },
          );
          const script = document.createElement("script");
          script.textContent = 'document.body.dataset["inline"] = "ran";';
          document.head.append(script);

          if (document.body.dataset["inline"] === "ran") resolve("ran");
        }),
    );

    expect(outcome).toBe("blocked by script-src-elem");
    expect(await open.problems()).toEqual({
      ...NO_PROBLEMS,
      policyViolations: [(await reported).text()],
    });
  });
});
