export function DesignMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 100.507 100.507"
      width={size}
      height={size}
      aria-hidden="true"
      className="design-mark"
    >
      <path
        className="design-mark-moon"
        d="M72.423 8.931A48 48 0 1 0 95.353 58.106 32 32 0 1 1 72.423 8.931Z"
      />
      <circle className="design-mark-light" cx="68.507" cy="40.691" r="32" />
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
