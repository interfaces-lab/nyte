function loadNodeOs() {
  if (typeof process === "undefined" || !(process.versions?.node || process.versions?.bun)) {
    return null;
  }

  return process.getBuiltinModule?.("node:os") ?? null;
}

const nodeOs = loadNodeOs();

export function getNyteUserAgent(): string {
  return nodeOs
    ? `nyte (${nodeOs.platform()} ${nodeOs.release()}; ${nodeOs.arch()})`
    : "nyte (browser)";
}
