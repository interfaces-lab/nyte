import "./tokens.css";
import "./controls.css";

const GLYPHS = {
  sparkles:
    "M6 1.5l1.2 3.3L10.5 6 7.2 7.2 6 10.5 4.8 7.2 1.5 6l3.3-1.2zM12 9l.7 1.8 1.8.7-1.8.7L12 14l-.7-1.8-1.8-.7 1.8-.7z",
  "moon.stars.fill":
    "M6.5 2a5.5 5.5 0 1 0 6.9 7.4A4.6 4.6 0 0 1 6.5 2zm5-1l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z",
  "sunrise.fill":
    "M3 11a5 5 0 0 1 10 0zM1 13h14v1.2H1zM8 1.2l2 2.2H9v2H7v-2H6zM2.3 5.2l1.4 1.4-.9.8L1.5 6zM13.7 5.2l.8.8-1.3 1.4-.9-.8z",
  "sunset.fill":
    "M3 11a5 5 0 0 1 10 0zM1 13h14v1.2H1zM8 5.6L6 3.4h1v-2h2v2h1zM2.3 5.2l1.4 1.4-.9.8L1.5 6zM13.7 5.2l.8.8-1.3 1.4-.9-.8z",
  "water.waves":
    "M1 5c1.2 0 1.2-1 2.3-1s1.2 1 2.4 1S6.8 4 8 4s1.2 1 2.3 1S11.5 4 12.7 4 13.8 5 15 5v1.3c-1.2 0-1.2-1-2.3-1s-1.2 1-2.4 1S9.2 5.3 8 5.3 6.8 6.3 5.7 6.3 4.5 5.3 3.3 5.3 2.2 6.3 1 6.3zm0 4.2c1.2 0 1.2-1 2.3-1s1.2 1 2.4 1S6.8 8.2 8 8.2s1.2 1 2.3 1 1.2-1 2.4-1 1.1 1 2.3 1v1.3c-1.2 0-1.2-1-2.3-1s-1.2 1-2.4 1S9.2 9.5 8 9.5s-1.2 1-2.3 1-1.2-1-2.4-1-1.1 1-2.3 1z",
  "play.fill": "M4 2.2v11.6L13.5 8z",
  waveform:
    "M2 6.5h1.3v3H2zM4.7 4h1.3v8H4.7zM7.3 1.5h1.4v13H7.3zM10 4.5h1.3v7H10zM12.7 6.5H14v3h-1.3z",
};

export function Icon({ name, size = 16, color }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      style={color === undefined ? undefined : { color }}
      aria-hidden
    >
      <path d={GLYPHS[name]} />
    </svg>
  );
}

export function Button({ label = "Continue", quiet = false }) {
  return (
    <div className={quiet ? "button quiet" : "button"}>
      <span className="label">{label}</span>
    </div>
  );
}

export function Chip({ label = "Waxing", icon = "moon.stars.fill" }) {
  return (
    <div className="chip">
      <Icon name={icon} size={12} />
      <span className="label ink-soft">{label}</span>
    </div>
  );
}

export function Stat({ label = "Moonrise", value = "18:42", icon = "sunrise.fill" }) {
  return (
    <div className="stat">
      <Icon name={icon} size={16} />
      <div className="stat-words">
        <span className="caption ink-faint">{label}</span>
        <span className="title ink">{value}</span>
      </div>
    </div>
  );
}

export default function Controls() {
  return (
    <div data-frame="Controls" data-x="0" data-y="0" className="controls">
      <span className="caption ink-faint">CONTROLS</span>
      <Button />
      <Button label="Not tonight" quiet />
      <div className="row">
        <Chip />
        <Chip label="Clear sky" icon="sparkles" />
        <Chip label="High tide" icon="water.waves" />
      </div>
      <div className="row wide">
        <Stat />
        <Stat label="Moonset" value="06:15" icon="sunset.fill" />
      </div>
    </div>
  );
}
