export function DesignMark({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden="true" className="design-mark">
      <path
        className="design-mark-moon"
        d="M56.817.817A48 48 0 1 0 95.183 39.183 32 32 0 1 1 56.817.817Z"
      />
      <circle className="design-mark-light" cx="64" cy="32" r="32" />
    </svg>
  );
}

export function DesignWordmark() {
  return (
    <span className="design-wordmark">
      <DesignMark />
      <span>Nyte Design</span>
    </span>
  );
}
