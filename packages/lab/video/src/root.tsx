import "@fontsource-variable/inter/opsz.css";
import { Composition, staticFile } from "remotion";
import { Film } from "./film";
import { durationInFrames, fps, soundtrack } from "./introduction";

async function load() {
  const response = await fetch(staticFile(soundtrack), { method: "HEAD" });

  if (!response.ok) throw new Error(`Introduction soundtrack is missing: ${soundtrack}`);

  return { durationInFrames };
}

export const Root = () => (
  <Composition
    id="nyte"
    component={Film}
    width={1920}
    height={1080}
    fps={fps}
    durationInFrames={durationInFrames}
    calculateMetadata={load}
  />
);
