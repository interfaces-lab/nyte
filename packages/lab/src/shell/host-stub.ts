/*
 * The renderer reads `window.nyte` while its modules evaluate, so the fixture
 * has to answer before anything that imports `queries.ts` loads. Import this
 * first.
 *
 * Every call rejects. The lab has no host, and a panel showing its own failed
 * state is a truer audit surface than one wired to invented data.
 */
const bridge: unknown = new Proxy(function host() {}, {
  get: (_target, key) => (key === "then" ? undefined : bridge),
  apply: () => Promise.reject(new Error("The lab has no host bridge")),
});

Object.defineProperty(window, "nyte", { value: bridge, configurable: true });
