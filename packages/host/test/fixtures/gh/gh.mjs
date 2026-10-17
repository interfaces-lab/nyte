/**
 * A stand-in for the GitHub CLI that the host's GitHub tests put on the PATH.
 * It reads its scenario from the JSON file `NYTE_FAKE_GH` names, writes
 * every invocation (arguments and stdin) to `<file>.log`, and keeps what a
 * command changes (sign-in, sign-out, a created pull request) in the file.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const file = process.env.NYTE_FAKE_GH ?? "";
const scenario = JSON.parse(readFileSync(file, "utf8"));
const args = process.argv.slice(2);
const stdin = args.includes("-") ? readFileSync(0, "utf8") : "";

appendFileSync(`${file}.log`, `${JSON.stringify({ args, stdin })}\n`);

const value = (name) => {
  const flag = args.findIndex((arg) => arg === name);

  return flag < 0 ? undefined : args[flag + 1];
};

const save = () => writeFileSync(file, JSON.stringify(scenario));

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const answer = (body) => {
  process.stdout.write(typeof body === "string" ? body : JSON.stringify(body));
  process.exit(0);
};

const [command, action] = args;

if (command === "auth" && action === "status") {
  if (scenario.cli === "old") fail("unknown flag: --json");

  if (scenario.auth === "signed_out") answer([]);

  answer([
    {
      active: true,
      state: scenario.auth === "invalid" ? "error" : "success",
      login: scenario.login,
    },
  ]);
}

if (command === "auth" && action === "login") {
  process.stderr.write("! First copy your one-time code: ABCD-1234\n");
  process.stderr.write(
    "Open this URL to continue in your web browser: https://github.com/login/device\n",
  );

  const started = Date.now();

  const wait = () => {
    if (existsSync(`${file}.approved`)) {
      scenario.auth = "ready";
      save();
      process.exit(0);
    }

    if (Date.now() - started > 20_000) process.exit(1);
    setTimeout(wait, 25);
  };

  wait();
} else if (command === "auth" && action === "logout") {
  if (value("--user") !== scenario.login) fail("not logged in to github.com as that account");
  scenario.auth = "signed_out";
  save();
  answer("");
} else if (command === "api") {
  if (scenario.api === "fail") fail("HTTP 503");

  answer({
    login: scenario.login,
    name: "The Octocat",
    avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
  });
} else if (command === "pr" && action === "view") {
  const pull = scenario.pulls?.[args[2]];

  if (pull === undefined) fail(`no pull requests found for branch "${args[2]}"`);
  answer(pull);
} else if (command === "pr" && action === "create") {
  if (scenario.create === "fail") fail("GraphQL: Head sha can't be blank (createPullRequest)");
  const head = value("--head");
  const number = 7;
  const url = `https://github.com/${value("--repo")}/pull/${number}`;
  scenario.pulls = {
    ...scenario.pulls,
    [head]: {
      number,
      title: value("--title") ?? "Filled from commits",
      url,
      state: "OPEN",
      isDraft: args.includes("--draft"),
      headRefName: head,
      baseRefName: "main",
      statusCheckRollup: [],
    },
  };
  save();
  answer(`Creating pull request for ${head} into main in ${value("--repo")}\n\n${url}\n`);
} else {
  fail(`unknown command: ${args.join(" ")}`);
}
