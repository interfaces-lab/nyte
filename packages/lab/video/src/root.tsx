import "@fontsource-variable/inter/opsz.css";
import { Value } from "typebox/value";
import { Composition, staticFile, type CalculateMetadataFunction } from "remotion";
import { Film, type FilmProps } from "./film";
import { Manifest } from "./manifest";
import { fps, timeline } from "./timeline";

const fetchText = async (path: string) => {
  const response = await fetch(staticFile(path));

  return response.ok ? response.text() : undefined;
};

/** Voice, score and commit log are optional; without a recording the film runs on estimated timings. */
const load: CalculateMetadataFunction<FilmProps> = async () => {
  const manifestText = await fetchText("voice/manifest.json");
  const parsed: unknown = manifestText ? JSON.parse(manifestText) : null;
  const manifest = Value.Check(Manifest, parsed) ? parsed : null;
  const music = (await fetch(staticFile("music/score.mp3"), { method: "HEAD" })).ok;
  const commits = (await fetchText("commits.txt"))?.split("\n").filter(Boolean) ?? [];

  return { durationInFrames: timeline(manifest).duration, props: { manifest, music, commits } };
};

export const Root = () => (
  <Composition
    id="nyte"
    component={Film}
    width={1920}
    height={1080}
    fps={fps}
    durationInFrames={fps * 60}
    defaultProps={{ manifest: null, music: false, commits: [] }}
    calculateMetadata={load}
  />
);
