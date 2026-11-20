import "../tokens.css";
import "./phase-card.css";
import { Chip } from "../controls.jsx";

export function Moon({ size = 168 }) {
  return (
    <div className="moon" style={{ width: size, height: size }}>
      <div className="moon-disc" />
      <div className="moon-light" />
    </div>
  );
}

export function PhaseCard({
  phase = "Waxing gibbous",
  lit = "82% lit",
  next = "Full in 3 nights",
}) {
  return (
    <div className="phase-card">
      <Moon />
      <div className="phase-words">
        <span className="title ink">{phase}</span>
        <span className="body ink-soft">{`${lit} · ${next}`}</span>
      </div>
      <div className="row">
        <Chip label="Waxing" />
        <Chip label="Clear sky" icon="sparkles" />
      </div>
    </div>
  );
}

export default function PhaseCards() {
  return (
    <>
      <div data-frame="Phase card" data-x="0" data-y="0" className="phase-sheet">
        <PhaseCard />
      </div>
      <div
        data-frame="Phase card · night"
        data-theme="night"
        data-x="430"
        data-y="0"
        className="phase-sheet"
      >
        <PhaseCard phase="Full moon" lit="100% lit" next="Wanes tomorrow" />
      </div>
    </>
  );
}
