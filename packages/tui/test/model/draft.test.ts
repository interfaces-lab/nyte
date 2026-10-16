import { asId } from "@nyte-ai/schema";
import type { SkillInfo } from "@nyte-ai/sdk";
import { describe, expect, test } from "bun:test";
import {
  addPart,
  draftContent,
  draftFromContent,
  draftModel,
  liveMarkers,
  NO_PARTS,
  pendingUploads,
  sameSnapshot,
  snapshot,
} from "../../src/model/draft.ts";
import type { DraftModel, DraftParts } from "../../src/model/draft.ts";

function draft(text: string, parts: DraftParts = NO_PARTS) {
  return { text, cursor: text.length, row: "only" as const, parts };
}

const NO_INPUTS = { uploads: new Map(), skills: new Map() };

describe("draftModel", () => {
  test.each([
    ["", { kind: "empty" }],
    ["   ", { kind: "blank" }],
    ["!ls -la", { kind: "shell", command: "ls -la", include: true }],
    ["!!secret", { kind: "shell", command: "secret", include: false }],
    [" !not shell", { kind: "message", text: "!not shell", plain: true, command: null }],
    ["/model fast", { kind: "message", text: "/model fast", plain: true, command: "model" }],
    ["fix it\nplease", { kind: "message", text: "fix it\nplease", plain: true, command: null }],
  ] satisfies [string, DraftModel][])("%j", (text, expected) => {
    expect(draftModel(draft(text))).toEqual(expected);
  });

  test("a draft holding a marker is not plain", () => {
    const { parts, marker } = addPart(NO_PARTS, {
      kind: "file",
      path: "/w/a.ts",
      directory: false,
    });

    expect(draftModel(draft(`see ${marker}`, parts))).toMatchObject({
      kind: "message",
      plain: false,
    });
  });
});

describe("markers", () => {
  test("files de-duplicate by path and suffix on name collisions", () => {
    const first = addPart(NO_PARTS, { kind: "file", path: "/w/a.ts", directory: false });
    const same = addPart(first.parts, { kind: "file", path: "/w/a.ts", directory: false });
    const other = addPart(first.parts, { kind: "file", path: "/x/a.ts", directory: false });
    const folder = addPart(NO_PARTS, { kind: "file", path: "/w/src/", directory: true });

    expect([first.marker, same.marker, other.marker, folder.marker]).toEqual([
      "[File a.ts]",
      "[File a.ts]",
      "[File a.ts 2]",
      "[Folder src]",
    ]);
  });

  test("images number up and de-duplicate by bytes; pastes and shells name themselves", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const one = addPart(NO_PARTS, { kind: "image", bytes, blob: null, mime: "image/png" });

    const again = addPart(one.parts, {
      kind: "image",
      bytes: new Uint8Array([1, 2, 3]),
      blob: null,
      mime: "image/png",
    });

    const two = addPart(one.parts, {
      kind: "image",
      bytes: new Uint8Array([4]),
      blob: null,
      mime: "image/png",
    });

    const paste = addPart(NO_PARTS, { kind: "paste", text: "a\nb\nc" });

    const shell = addPart(NO_PARTS, {
      kind: "shell",
      command: "echo  kept",
      output: "kept\n",
      exit: 0,
    });

    expect([one.marker, again.marker, two.marker, paste.marker, shell.marker]).toEqual([
      "[Image 1]",
      "[Image 1]",
      "[Image 2]",
      "[Paste #1 3 lines]",
      "[Shell echo kept]",
    ]);
  });

  test("live markers are the ones still in the text; a snapshot keeps only those", () => {
    const a = addPart(NO_PARTS, { kind: "paste", text: "x" });
    const b = addPart(a.parts, { kind: "paste", text: "y" });
    const current = draft(`${b.marker} and ${b.marker}`, b.parts);

    expect(liveMarkers(current).map((span) => [span.marker, span.from])).toEqual([
      ["[Paste #2 1 chars]", 0],
      ["[Paste #2 1 chars]", 23],
    ]);
    expect([...snapshot(current).parts.keys()]).toEqual(["[Paste #2 1 chars]"]);
  });
});

describe("content", () => {
  test("a shell marker expands to one <shell> block before the text", () => {
    const { parts, marker } = addPart(NO_PARTS, {
      kind: "shell",
      command: "echo kept",
      output: "kept\n",
      exit: 0,
    });

    const content = draftContent({ text: `${marker} what now?`, parts }, NO_INPUTS);

    expect(content).toBe('<shell command="echo kept" exit="0">\nkept\n</shell> what now?');
  });

  test("a file marker becomes a reference the host reads", () => {
    const { parts, marker } = addPart(NO_PARTS, {
      kind: "file",
      path: "/w/a b.ts",
      directory: false,
    });

    expect(draftContent({ text: `read ${marker}`, parts }, NO_INPUTS)).toEqual([
      { kind: "text", text: "read " },
      { kind: "reference", path: "/w/a b.ts" },
    ]);
  });

  test("images become file parts at their marker, once uploaded", () => {
    const { parts, marker } = addPart(NO_PARTS, {
      kind: "image",
      bytes: new Uint8Array([9]),
      blob: null,
      mime: "image/png",
    });

    const text = `before ${marker} after`;

    expect(pendingUploads({ text, parts })).toMatchObject([
      { marker: "[Image 1]", mime: "image/png" },
    ]);
    expect(
      draftContent({ text, parts }, { ...NO_INPUTS, uploads: new Map([[marker, asId("blob-1")]]) }),
    ).toEqual([
      { kind: "text", text: "before " },
      { kind: "file", blob: asId("blob-1"), mime: "image/png", name: "image-1.png" },
      { kind: "text", text: " after" },
    ]);
  });

  test("a leading or inline /skill becomes a skill part", () => {
    const skill: SkillInfo = {
      name: "review",
      owner: "w",
      description: "Review",
      location: "/s/review.md",
    };

    const skills = new Map([["review", skill]]);

    const part = { kind: "skill", name: "review", location: "/s/review.md" } as const;

    expect(
      draftContent({ text: "/review the diff", parts: NO_PARTS }, { ...NO_INPUTS, skills }),
    ).toEqual([part, { kind: "text", text: "the diff" }]);
    expect(
      draftContent({ text: "please /review it", parts: NO_PARTS }, { ...NO_INPUTS, skills }),
    ).toEqual([{ kind: "text", text: "please " }, part, { kind: "text", text: " it" }]);
  });
});

describe("round trips", () => {
  test("file, shell and image content comes back as the same markers", () => {
    const content = [
      { kind: "text" as const, text: "look " },
      { kind: "reference" as const, path: "/w/a.ts" },
      { kind: "text" as const, text: " " },
      { kind: "file" as const, blob: asId<"blob">("b1"), mime: "image/png", name: "image-1.png" },
      { kind: "text" as const, text: ' <shell command="ls" exit="2">\nout\n</shell>' },
    ];

    const back = draftFromContent(content);

    expect(back.text).toBe("look [File a.ts] [Image 1] [Shell ls]");
    expect(back.parts.get("[File a.ts]")).toEqual({
      kind: "file",
      path: "/w/a.ts",
      directory: false,
    });
    expect(back.parts.get("[Shell ls]")).toEqual({
      kind: "shell",
      command: "ls",
      output: "out\n",
      exit: 2,
    });
    expect(draftContent(back, NO_INPUTS)).toEqual(content);
  });

  test("a folder reference and a skill part come back as their short forms", () => {
    expect(draftFromContent([{ kind: "reference", path: "/w/src/" }]).text).toBe("[Folder src]");
    expect(
      draftFromContent([
        { kind: "skill", name: "review", location: "/s/r.md" },
        { kind: "text", text: "now" },
      ]).text,
    ).toBe("/review now");
  });

  test("a recalled `!` message never becomes a shell command", () => {
    expect(draftFromContent("!rm -rf").text).toBe(" !rm -rf");
  });

  test("same snapshot means same send", () => {
    const back = draftFromContent('x <shell command="ls" exit="0">\no\n</shell>');

    expect(
      sameSnapshot(back, draftFromContent('x <shell command="ls" exit="0">\no\n</shell>')),
    ).toBe(true);
    expect(sameSnapshot(back, { ...back, text: `${back.text} more` })).toBe(false);
  });
});
