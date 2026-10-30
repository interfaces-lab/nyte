import { describe, expect, it } from "vitest";
import { createShellStream } from "../src/local/shell-integration/stream.ts";
import type { ShellState } from "../src/local/shell-integration/stream.ts";

const nonce = "0123456789abcdef".repeat(4);

const other = "fedcba9876543210".repeat(4);

const ST = "\x1b\\";

const marker = (body: string, end = "\x07"): string => `\x1b]633;${body}${end}`;

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
    input: `${marker("A")}$ ${marker("B")}${marker("C")}${marker("D;0")}${marker("P;Cwd=/tmp", ST)}${marker("E;ls;nonce")}\x1b]633\x07`,
    shown: "$ ",
    state: inactive,
  },
  {
    name: "OSC 133, titles, links, colours and the alternate screen, unchanged",
    input:
      "\x1b]133;A\x07$ \x1b]0;title\x07\x1b]8;;https://nyte.sh\x1b\\link\x1b]8;;\x1b\\\x1b[31mred\x1b[0m\x1b[?1049h\x1b[2J\x1b[H",
    shown:
      "\x1b]133;A\x07$ \x1b]0;title\x07\x1b]8;;https://nyte.sh\x1b\\link\x1b]8;;\x1b\\\x1b[31mred\x1b[0m\x1b[?1049h\x1b[2J\x1b[H",
    state: inactive,
  },
  {
    name: "OSC numbers that only start like 633",
    input: "\x1b]6331;x\x07\x1b]63;x\x07\x1b]6;x\x07",
    shown: "\x1b]6331;x\x07\x1b]63;x\x07\x1b]6;x\x07",
    state: inactive,
  },
  {
    name: "a marker's text inside another OSC",
    input: `\x1b]9999;633;Nyte;1;${nonce};C\x07`,
    shown: `\x1b]9999;633;Nyte;1;${nonce};C\x07`,
    state: inactive,
  },
  {
    name: "a marker's text inside APC, DCS, PM and SOS strings, where BEL does not end them",
    input: ["_", "P", "^", "X"]
      .map((kind) => `\x1b${kind}]633;Nyte;1;${nonce};C\x07tail${ST}`)
      .join(""),
    shown: ["_", "P", "^", "X"]
      .map((kind) => `\x1b${kind}]633;Nyte;1;${nonce};C\x07tail${ST}`)
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
    input: `\x1b]633;Nyte;1;${nonce};C\x18after`,
    shown: "\x18after",
    state: inactive,
  },
  {
    name: "a marker cut short by another escape sequence",
    input: `\x1b]633;Nyte;1;${nonce};C\x1b[31mred`,
    shown: "\x1b[31mred",
    state: inactive,
  },
  {
    name: "a marker cut short by a valid one",
    input: `\x1b]633;Nyte;1;${nonce};C${marker(`Nyte;1;${nonce};A;1`)}`,
    shown: "",
    state: { kind: "prompt", jobs: 1 },
  },
  {
    name: "a marker left open at the end, its nonce never shown",
    input: `text\x1b]633;Nyte;1;${nonce};C`,
    shown: "text",
    state: inactive,
  },
  {
    name: "other sequences left open at the end",
    input: "a\x1b]0;tit\x1bP1$",
    shown: "a\x1b]0;tit\x1bP1$",
    state: inactive,
  },
  {
    name: "a lone escape at the end",
    input: "a\x1b",
    shown: "a\x1b",
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
  for (const test of cases)
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

  it("streams text and other strings without waiting for their end", () => {
    const stream = createShellStream(nonce);

    expect(stream.read("plain")).toBe("plain");
    expect(stream.read("\x1b]0;a long tit")).toBe("\x1b]0;a long tit");
    expect(stream.read("le\x07")).toBe("le\x07");
    expect(stream.read("\x1b]633;Nyte;1;")).toBe("");
    expect(stream.read(`${nonce};C\x07ok`)).toBe("ok");
    expect(stream.state()).toEqual({ kind: "running" });
  });
});
