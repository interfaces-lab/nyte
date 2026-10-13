import { Audio } from "@remotion/media";
import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, Sequence, staticFile, useVideoConfig } from "remotion";
import type { LineId } from "../script";
import type { Manifest } from "./manifest";
import { clamp } from "./look";
import { Cheap, Same, Weekend } from "./scenes/day";
import { End, Longer, Phases } from "./scenes/moon";
import { Git, Numbers, Phone } from "./scenes/proof";
import { Together } from "./scenes/together";
import { timeline, type Cue } from "./timeline";

export type FilmProps = { manifest: Manifest | null; music: boolean; commits: string[] };

/**
 * Music sits about 11 LU under the voice, as in the Notion film (measured there: voice -15, music -26 LUFS).
 * Without a voice the music plays at full level.
 */
const bed = 0.25;

const Scene = ({ cue, commits }: { cue: Cue; commits: string[] }) => {
  const scenes = {
    weekend: Weekend,
    same: Same,
    cheap: Cheap,
    longer: Longer,
    git: Git,
    phone: Phone,
    together: Together,
    night: Phases,
    end: End,
  } satisfies Record<Exclude<LineId, "numbers">, (props: { cue: Cue }) => ReactNode>;

  if (cue.id === "numbers") return <Numbers cue={cue} commits={commits} />;
  const Component = scenes[cue.id];

  return <Component cue={cue} />;
};

export const Film = ({ manifest, music, commits }: FilmProps) => {
  const { cues } = timeline(manifest);
  const level = cues.some((cue) => cue.audio) ? bed : 1;
  const { durationInFrames, fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {cues.map((cue) => (
        <Sequence key={cue.id} from={cue.from} durationInFrames={cue.length} premountFor={fps}>
          <Scene cue={cue} commits={commits} />
          {cue.audio && (
            <Sequence from={cue.voiceAt} layout="none">
              <Audio src={staticFile(cue.audio)} />
            </Sequence>
          )}
        </Sequence>
      ))}
      {music && (
        <Audio
          src={staticFile("music/score.mp3")}
          volume={(frame) =>
            interpolate(frame, [durationInFrames - fps, durationInFrames], [level, 0], clamp)
          }
        />
      )}
    </AbsoluteFill>
  );
};
