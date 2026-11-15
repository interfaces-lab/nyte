// A host for working on Nyte Studio without a model account: the real host and its file tools
// over a copy of the sample project, with a scripted model that edits the designs.

import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import { fakeModels, lastUserText, testModel, titleReply } from "@nyte-ai/bench";
import type { Reply, Request } from "@nyte-ai/bench";
import { sqliteStore } from "@nyte-ai/host";
import { sdk } from "@nyte-ai/sdk";

const port = Number(process.env.NYTE_STUDIO_DEV_PORT ?? 0);

const token = process.env.NYTE_STUDIO_DEV_TOKEN ?? "nyte-studio-dev-token-0123456789abcdef";

const pacing = { firstMs: 350, deltaMs: 18 };

interface Move {
  readonly match: RegExp;
  readonly say: string;
  readonly path: string;
  readonly edits: readonly { readonly oldText: string; readonly newText: string }[];
  readonly done: string;
}

const moves: readonly Move[] = [
  {
    match: /warm|amber|sunset|dawn/iu,
    say: "The accent lives in the tokens, so one change warms every screen that uses it.",
    path: "design/tokens.lune",
    edits: [
      {
        oldText: '<color name="accent" value="#3f58a8" dark="#c1d0f6" />',
        newText: '<color name="accent" value="#b4532a" dark="#ffcf9a" />',
      },
      {
        oldText: '<color name="moon" value="#647fcb" dark="#7a93d6" />',
        newText: '<color name="moon" value="#d98a5b" dark="#e2a077" />',
      },
      {
        oldText: '<color name="moon.rim" value="#c1d0f6" dark="#c1d0f6" />',
        newText: '<color name="moon.rim" value="#ffd9b8" dark="#ffd9b8" />',
      },
    ],
    done: "Accent and moon are warm now. The button, the chips and both phase cards picked it up from the tokens.",
  },
  {
    match: /tide|add|row|tile/iu,
    say: "I'll add a tide row under the stats, built from the same Stat tile.",
    path: "design/screens/tonight.lune",
    edits: [
      {
        oldText: '    <box h="fill" />\n    <Button w="fill" label="Wake me at moonset" />\n  </col>\n</frame>\n\n<frame name="Tonight · night"',
        newText:
          '    <row gap="12" w="fill">\n      <Stat label="High tide" value="23:08" icon="water.waves" />\n      <Stat label="Low tide" value="05:21" icon="water.waves" />\n    </row>\n\n    <box h="fill" />\n    <Button w="fill" label="Wake me at moonset" />\n  </col>\n</frame>\n\n<frame name="Tonight · night"',
      },
    ],
    done: "Tonight has a tide row now, two Stat tiles under moonrise and moonset.",
  },
  {
    match: /round|soft|radius/iu,
    say: "Radii are tokens too. I'll soften the card, the tiles and the controls together.",
    path: "design/tokens.lune",
    edits: [
      {
        oldText: '<number name="radius.card" value="28" />',
        newText: '<number name="radius.card" value="36" />',
      },
      {
        oldText: '<number name="radius.tile" value="20" />',
        newText: '<number name="radius.tile" value="26" />',
      },
      {
        oldText: '<number name="radius.control" value="14" />',
        newText: '<number name="radius.control" value="26" />',
      },
    ],
    done: "Everything is rounder: cards at 36, tiles and controls at 26.",
  },
];

const fallbackMove: Move = {
  match: /./u,
  say: "I'll put that in the headline so you can see it land on the canvas.",
  path: "design/screens/tonight.lune",
  edits: [
    {
      oldText: '<text style="$display" color="$ink">Tonight</text>\n    </col>\n\n    <PhaseCard />\n\n    <row gap="12" w="fill">\n      <Stat />\n      <Stat label="Moonset" value="06:15" icon="sunset.fill" />\n    </row>\n\n    <row w="fill" pad="14 16"',
      newText:
        '<text style="$display" color="$ink">Clear tonight</text>\n    </col>\n\n    <PhaseCard />\n\n    <row gap="12" w="fill">\n      <Stat />\n      <Stat label="Moonset" value="06:15" icon="sunset.fill" />\n    </row>\n\n    <row w="fill" pad="14 16"',
    },
  ],
  done: "The headline reads “Clear tonight” on the day screen.",
};

function answer(request: Request): Reply {
  const title = titleReply(request);

  if (title !== null) return { content: [{ type: "text", text: title.slice(0, 48) }] };

  const prompt = lastUserText(request);
  const move = moves.find((candidate) => candidate.match.test(prompt)) ?? fallbackMove;
  const last = request.context.messages.at(-1);

  if (last?.role === "toolResult")
    return { content: [{ type: "text", text: move.done }], timing: pacing };

  return {
    content: [
      { type: "text", text: move.say },
      {
        type: "toolCall",
        id: `edit-${String(request.context.messages.length)}`,
        name: "edit",
        arguments: { path: move.path, edits: move.edits },
      },
    ],
    stopReason: "toolUse",
    timing: pacing,
  };
}

const { models } = fakeModels({
  id: "studio-dev",
  name: "Studio Dev",
  models: [testModel("moonlight", { name: "Moonlight", provider: "studio-dev" })],
  into: createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  }),
  fallback: answer,
});

const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-studio-dev-")));

const project = join(root, "tide");

const home = join(root, "home");

await cp(join(import.meta.dirname, "../sample"), project, { recursive: true });

await mkdir(home, { recursive: true });

for (const args of [
  ["init", "-q"],
  ["config", "user.name", "Studio Dev"],
  ["config", "user.email", "studio@example.test"],
  ["add", "--all"],
  ["commit", "-qm", "Seed the Tide designs"],
])
  execFileSync("git", args, { cwd: project });

const host = await sdk.open({
  store: sqliteStore({ memory: true }),
  models,
  workspace: { kind: "local", path: project },
  home,
});

await host.settings.apply("permissions", "full");

const listener = await host.listen({
  transport: { kind: "http", hostname: "127.0.0.1", ...(port === 0 ? {} : { port }) },
  auth: { kind: "token", token },
});

const endpoint = join(home, "host.json");

await writeFile(
  endpoint,
  JSON.stringify({ url: listener.address, token, pid: process.pid, socket: null }),
  { mode: 0o600 },
);

const stop = (): void => {
  void listener
    .close()
    .then(() => host.close())
    .then(() => rm(root, { recursive: true, force: true }))
    .finally(() => process.exit(0));
};

process.once("SIGINT", stop);

process.once("SIGTERM", stop);

process.stdout.write(
  `${JSON.stringify({ type: "listening", url: listener.address, endpoint, project, token })}\n`,
);
