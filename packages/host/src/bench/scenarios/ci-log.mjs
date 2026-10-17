/**
 * The CI run the GitHub-like fixtures report: two check runs, `lint` passing
 * and `test` failing, and the failing job's log of setup noise whose last
 * lines are the failure `ci-repo` reproduces.
 */

/** The check runs of the fixture pull request's head commit. */
export const CHECK_RUNS = [
  {
    id: 1,
    name: "lint",
    status: "completed",
    conclusion: "success",
    html_url: "https://ci.fixture.test/run/1/job/1",
  },
  {
    id: 2,
    name: "test",
    status: "completed",
    conclusion: "failure",
    html_url: "https://ci.fixture.test/run/1/job/2",
  },
];

/** The end of the failing job's log: what `node --test` printed, then the runner's verdict. */
export const FAILURE = [
  "not ok 1 - sum adds",
  "  ---",
  "  location: 'test/sum.test.js:5:1'",
  "  failureType: 'testCodeFailure'",
  "  error: |-",
  "    Expected values to be strictly equal:",
  "",
  "    -1 !== 3",
  "",
  "  code: 'ERR_ASSERTION'",
  "  stack: |-",
  "    TestContext.<anonymous> (test/sum.test.js:6:10)",
  "  ...",
  "# tests 1",
  "# pass 0",
  "# fail 1",
  "##[error]Process completed with exit code 1.",
  "",
].join("\n");

/** The failing job's log, about `bytes` long (default 5 MiB): numbered setup lines, then `FAILURE`. */
export function ciLog(bytes = 5 * 1024 * 1024) {
  const lines = [];
  let size = FAILURE.length;

  for (let step = 1; size < bytes; step += 1) {
    const line = `2026-10-16T12:00:00.000Z step ${String(step).padStart(6, "0")} ok\n`;
    lines.push(line);
    size += line.length;
  }

  return lines.join("") + FAILURE;
}
