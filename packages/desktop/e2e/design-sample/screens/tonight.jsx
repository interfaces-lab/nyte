import "../tokens.css";
import "./tonight.css";
import { Button, Icon, Stat } from "../controls.jsx";
import { PhaseCard } from "../blocks/phase-card.jsx";

export default function Tonight() {
  return (
    <>
      <div data-frame="Tonight" data-x="1892" data-y="125" className="tonight">
        <div className="tonight-column">
          <div className="heading">
            <span className="caption ink-faint">THURSDAY · 14 NOVEMBER</span>
            <span className="display ink">Tonight</span>
          </div>

          <PhaseCard />

          <div className="row wide">
            <Stat />
            <Stat label="Moonset" value="06:15" icon="sunset.fill" />
          </div>

          <div className="track">
            <div className="track-art">
              <Icon name="waveform" size={18} />
            </div>
            <div className="track-words">
              <span className="label ink">Low tide, slow water</span>
              <span className="caption ink-faint">NIGHT SOUNDS · 42 MIN</span>
            </div>
            <Icon name="play.fill" size={18} color="var(--ink)" />
          </div>

          <div className="spacer" />
          <Button label="Wake me at moonset" />
        </div>
      </div>

      <div
        data-frame="Tonight · night"
        data-theme="night"
        data-x="1400"
        data-y="125"
        className="tonight"
      >
        <div className="tonight-column">
          <div className="heading">
            <span className="caption ink-faint">THURSDAY · 14 NOVEMBER</span>
            <span className="display ink">Tonight</span>
          </div>

          <PhaseCard />

          <div className="row wide">
            <Stat />
            <Stat label="Moonset" value="06:15" icon="sunset.fill" />
          </div>

          <div className="spacer" />
          <Button label="Wake me at moonset" />
        </div>
      </div>
    </>
  );
}
