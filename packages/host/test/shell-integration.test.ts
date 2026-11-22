import { describe, expect, it } from "vitest";
import { createShellStream } from "../src/local/process/shell-integration/stream.ts";
import type { ShellState } from "../src/local/process/shell-integration/stream.ts";

const nonce = "0123456789abcdef".repeat(4);

const other = "fedcba9876543210".repeat(4);

const ST = "\u001B\\";

const marker = (body: string, end = "\u0007"): string => `\u001B]633;${body}${end}`;

const inactive: ShellState = { kind: "inactive" };

const cases: readonly {
  readonly name: string;
  readonly input: string;
  readonly shown: string;
  readonly state: ShellState;
  readonly nonce?: string | null;
}[] = [
  {
    name: "a prompt marker ended by BEL",
    input: `before${marker(`Nyte;1;${nonce};A;0`)}after`,
    shown: "beforeafter",
    state: { kind: "prompt", jobs: 0 },
  },
  {
    name: "a prompt marker ended by ST, with jobs",
    input: `${marker(`Nyte;1;${nonce};A;12`, ST)}$ `,
    shown: "$ ",
    state: { kind: "prompt", jobs: 12 },
  },
  {
    name: "a command marker",
    input: `ls\r\n${marker(`Nyte;1;${nonce};C`)}file\r\n`,
    shown: "ls\r\nfile\r\n",
    state: { kind: "running" },
  },
  {
    name: "adjacent markers, the last one winning",
    input: `${marker(`Nyte;1;${nonce};C`)}${marker(`Nyte;1;${nonce};A;3`, ST)}`,
    shown: "",
    state: { kind: "prompt", jobs: 3 },
  },
  {
    name: "a disabling marker after a prompt",
    input: `${marker(`Nyte;1;${nonce};A;0`)}${marker(`Nyte;1;${nonce};X`)}`,
    shown: "",
    state: inactive,
  },
  {
    name: "another terminal's nonce",
    input: `a${marker(`Nyte;1;${other};A;0`)}b`,
    shown: "ab",
    state: inactive,
  },
  {
    name: "a valid marker where the terminal expects none",
    input: `a${marker(`Nyte;1;${nonce};A;0`)}b`,
    shown: "ab",
    state: inactive,
    nonce: null,
  },
  {
    name: "a missing nonce",
    input: marker("Nyte;1;A;0"),
    shown: "",
    state: inactive,
  },
  {
    name: "an uppercase nonce",
    input: marker(`Nyte;1;${nonce.toUpperCase()};C`),
    shown: "",
    state: inactive,
  },
  {
    name: "another protocol version",
    input: marker(`Nyte;2;${nonce};C`),
    shown: "",
    state: inactive,
  },
  {
    name: "extra fields",
    input: `${marker(`Nyte;1;${nonce};C;1`)}${marker(`Nyte;1;${nonce};A;0;1`)}`,
    shown: "",
    state: inactive,
  },
  {
    name: "malformed job counts",
    input: ["01", "-1", "1x", "", " 1", "1234567"]
      .map((jobs) => marker(`Nyte;1;${nonce};A;${jobs}`))
      .join(""),
    shown: "",
    state: inactive,
  },
  {
    name: "a NUL in a marker",
    input: marker(`Nyte;1;${nonce};C\0`),
    shown: "",
    state: inactive,
  },
  {
    name: "VS Code's unauthenticated markers",
    input: `${marker("A")}$ ${marker("B")}${marker("C")}${marker("D;0")}${marker("P;Cwd=/tmp", ST)}${marker("E;ls;nonce")}\u001B]633\u0007`,
    shown: "$ ",
    state: inactive,
  },
  {
    name: "OSC 133, titles, links, colours and the alternate screen, unchanged",
    input:
      "\u001B]133;A\u0007$ \u001B]0;title\u0007\u001B]8;;https://nyte.sh\u001B\\link\u001B]8;;\u001B\\\u001B[31mred\u001B[0m\u001B[?1049h\u001B[2J\u001B[H",
    shown:
      "\u001B]133;A\u0007$ \u001B]0;title\u0007\u001B]8;;https://nyte.sh\u001B\\link\u001B]8;;\u001B\\\u001B[31mred\u001B[0m\u001B[?1049h\u001B[2J\u001B[H",
    state: inactive,
  },
  {
    name: "OSC numbers that only start like 633",
    input: "\u001B]6331;x\u0007\u001B]63;x\u0007\u001B]6;x\u0007",
    shown: "\u001B]6331;x\u0007\u001B]63;x\u0007\u001B]6;x\u0007",
    state: inactive,
  },
  {
    name: "a marker's text inside another OSC",
    input: `\u001B]9999;633;Nyte;1;${nonce};C\u0007`,
    shown: `\u001B]9999;633;Nyte;1;${nonce};C\u0007`,
    state: inactive,
  },
  {
    name: "a marker's text inside APC, DCS, PM and SOS strings, where BEL does not end them",
    input: ["_", "P", "^", "X"]
      .map((kind) => `\u001B${kind}]633;Nyte;1;${nonce};C\u0007tail${ST}`)
      .join(""),
    shown: ["_", "P", "^", "X"]
      .map((kind) => `\u001B${kind}]633;Nyte;1;${nonce};C\u0007tail${ST}`)
      .join(""),
    state: inactive,
  },
  {
    name: "an oversized marker, discarded through its terminator",
    input: `${marker(`Nyte;1;${nonce};C${"x".repeat(20_000)}`)}after`,
    shown: "after",
    state: inactive,
  },
  {
    name: "a marker cancelled by CAN",
    input: `\u001B]633;Nyte;1;${nonce};C\u0018after`,
    shown: "\u0018after",
    state: inactive,
  },
  {
    name: "a marker cut short by another escape sequence",
    input: `\u001B]633;Nyte;1;${nonce};C\u001B[31mred`,
    shown: "\u001B[31mred",
    state: inactive,
  },
  {
    name: "a marker cut short by a valid one",
    input: `\u001B]633;Nyte;1;${nonce};C${marker(`Nyte;1;${nonce};A;1`)}`,
    shown: "",
    state: { kind: "prompt", jobs: 1 },
  },
  {
    name: "a marker left open at the end, its nonce never shown",
    input: `text\u001B]633;Nyte;1;${nonce};C`,
    shown: "text",
    state: inactive,
  },
  {
    name: "other sequences left open at the end",
    input: "a\u001B]0;tit\u001BP1$",
    shown: "a\u001B]0;tit\u001BP1$",
    state: inactive,
  },
  {
    name: "a lone escape at the end",
    input: "a\u001B",
    shown: "a\u001B",
    state: inactive,
  },
  {
    name: "UTF-8 text around a marker",
    input: `héllo ${marker(`Nyte;1;${nonce};C`)}wörld 🎉`,
    shown: "héllo wörld 🎉",
    state: { kind: "running" },
  },
];

describe("createShellStream", () => {
  for (const test of cases) {
    it(`handles ${test.name} at every split`, () => {
      for (let split = 0; split <= test.input.length; split += 1) {
        const stream = createShellStream(test.nonce === undefined ? nonce : test.nonce);

        const shown =
          stream.read(test.input.slice(0, split)) +
          stream.read(test.input.slice(split)) +
          stream.end();

        expect({ split, shown, state: stream.state() }).toEqual({
          split,
          shown: test.shown,
          state: test.state,
        });
      }

      const stream = createShellStream(test.nonce === undefined ? nonce : test.nonce);

      const shown =
        test.input
          .split("")
          .map((char) => stream.read(char))
          .join("") + stream.end();

      expect({ shown, state: stream.state() }).toEqual({ shown: test.shown, state: test.state });
    });
  }

  it("streams text and other strings without waiting for their end", () => {
    const stream = createShellStream(nonce);

    expect(stream.read("plain")).toBe("plain");
    expect(stream.read("\u001B]0;a long tit")).toBe("\u001B]0;a long tit");
    expect(stream.read("le\u0007")).toBe("le\u0007");
    expect(stream.read("\u001B]633;Nyte;1;")).toBe("");
    expect(stream.read(`${nonce};C\u0007ok`)).toBe("ok");
    expect(stream.state()).toEqual({ kind: "running" });
  });
});
