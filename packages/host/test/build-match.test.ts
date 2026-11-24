import { API_MIN_REVISION, API_REVISION } from "@nyte-ai/schema";
import type { Authority, ClientKind, HelloFrame } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import { matchBuild } from "../src/serve/build-match.ts";
import type { Supervisor } from "../src/serve/build-match.ts";

const HOST = "0.0.29";

const DIGEST = "a1b2c3d4e5f60718";

const OWN: ReadonlySet<Authority> = new Set(["participant", "owner", "maintenance"]);

const PAIRED: ReadonlySet<Authority> = new Set(["participant", "owner"]);

interface Row {
  readonly name: string;
  readonly revisions?: { readonly min: number; readonly max: number };
  readonly host?: string;
  readonly version: string;
  readonly digest?: string;
  readonly authority?: ReadonlySet<Authority>;
  readonly supervisor: Supervisor | null;
  readonly kind: ClientKind;
  readonly match: unknown;
}

const rows: readonly Row[] = [
  {
    name: "a client that needs a later revision than the host serves",
    revisions: { min: API_REVISION + 1, max: API_REVISION + 1 },
    version: "0.0.30",
    supervisor: "launchd",
    kind: "app",
    match: { reason: "update-host", message: expect.stringMatching(/^Update the host: /u) },
  },
  {
    name: "a client older than every revision the host serves",
    revisions: { min: 1, max: API_MIN_REVISION - 1 },
    version: "0.0.20",
    supervisor: "launchd",
    kind: "app",
    match: { reason: "update-client", message: expect.stringMatching(/^Update the client: /u) },
  },
  {
    name: "the same build",
    version: HOST,
    supervisor: "launchd",
    kind: "app",
    match: { kind: "current" },
  },
  {
    name: "an older client inside the window",
    version: "0.0.28",
    digest: "0000000000000000",
    supervisor: "launchd",
    kind: "app",
    match: { kind: "host-newer" },
  },
  {
    name: "a newer app over its own launchd host",
    version: "0.0.30",
    supervisor: "launchd",
    kind: "app",
    match: { kind: "host-older", replace: "when-idle" },
  },
  {
    name: "a newer terminal over the app's launchd host",
    version: "0.0.30",
    supervisor: "launchd",
    kind: "tui",
    match: { kind: "host-older", replace: "none" },
  },
  {
    name: "a newer terminal over the host it started",
    version: "0.0.30",
    supervisor: "nyte",
    kind: "tui",
    match: { kind: "host-older", replace: "when-idle" },
  },
  {
    name: "a newer one-shot command over the host a terminal started",
    version: "0.0.30",
    supervisor: "nyte",
    kind: "cli",
    match: { kind: "host-older", replace: "when-idle" },
  },
  {
    name: "a newer app over a host a terminal started",
    version: "0.0.30",
    supervisor: "nyte",
    kind: "app",
    match: { kind: "host-older", replace: "manual" },
  },
  {
    name: "a newer app over a plain nyte host",
    version: "0.0.30",
    supervisor: null,
    kind: "app",
    match: { kind: "host-older", replace: "manual" },
  },
  {
    name: "a newer paired phone, which can't restart the host",
    version: "0.0.30",
    authority: PAIRED,
    supervisor: "launchd",
    kind: "app",
    match: { kind: "host-older", replace: "none" },
  },
  {
    name: "the same version built with other operations",
    version: HOST,
    digest: "ffffffffffffffff",
    supervisor: "launchd",
    kind: "app",
    match: { kind: "host-older", replace: "manual" },
  },
  {
    name: "a version that is not semver, with the host's operations",
    version: "dev",
    supervisor: "launchd",
    kind: "app",
    match: { kind: "current" },
  },
  {
    name: "a version that is not semver, with other operations",
    version: "dev",
    digest: "ffffffffffffffff",
    supervisor: "launchd",
    kind: "app",
    match: { kind: "host-older", replace: "manual" },
  },
  {
    name: "a release over its nightly",
    host: "0.0.30-nightly.2",
    version: "0.0.30",
    supervisor: "launchd",
    kind: "app",
    match: { kind: "host-older", replace: "when-idle" },
  },
];

function hello(row: Pick<Row, "revisions" | "version" | "digest" | "kind">): HelloFrame {
  return {
    c: "e",
    type: "hello",
    api_min_revision: row.revisions?.min ?? API_MIN_REVISION,
    api_revision: row.revisions?.max ?? API_REVISION,
    operations: row.digest ?? DIGEST,
    client: { kind: row.kind, name: "Nyte", version: row.version, actions: [] },
  };
}

it("decides the build match from the revisions, the versions, the digests, the authority, the supervisor and the client kind", () => {
  expect(
    rows.map((row) => ({
      name: row.name,
      match: matchBuild(
        {
          version: row.host ?? HOST,
          operations: DIGEST,
          supervisor: row.supervisor,
        },
        hello(row),
        row.authority ?? OWN,
      ),
    })),
  ).toEqual(rows.map((row) => ({ name: row.name, match: row.match })));
});

const BUILDS = [
  { version: "0.0.28", digest: DIGEST },
  { version: "0.0.29", digest: DIGEST },
  { version: "0.0.29", digest: "ffffffffffffffff" },
  { version: "0.0.30-nightly.9", digest: DIGEST },
  { version: "0.0.30-nightly.10", digest: DIGEST },
  { version: "0.0.30", digest: DIGEST },
  { version: "dev", digest: "0000000000000000" },
] as const;

it("never lets two app builds sharing a home each retire the other's host", () => {
  const retires = (host: (typeof BUILDS)[number], client: (typeof BUILDS)[number]): boolean => {
    const match = matchBuild(
      { version: host.version, operations: host.digest, supervisor: "launchd" },
      hello({ version: client.version, digest: client.digest, kind: "app" }),
      OWN,
    );

    return "kind" in match && match.kind === "host-older" && match.replace === "when-idle";
  };

  expect(
    BUILDS.flatMap((left) =>
      BUILDS.flatMap((right) =>
        retires(left, right) && retires(right, left) ? [[left, right]] : [],
      ),
    ),
  ).toEqual([]);
});
