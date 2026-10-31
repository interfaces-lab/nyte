/**
 * An origin `ListenOptions.origins` accepts, in lowercase with no path: an exact `https://` origin,
 * `https://*.` and a domain of at least two labels for its subdomains (never `*.com`), or a loopback
 * `http://` origin. Those are the pages a browser treats as secure contexts, so a plain-http page
 * on the network never receives a host's credential.
 */
export const ORIGIN_PATTERN =
  "^(https://([a-z0-9-]+\\.)*[a-z0-9-]+|https://\\*\\.([a-z0-9-]+\\.)+[a-z]{2,}|http://(localhost|127\\.0\\.0\\.1|\\[::1\\]))(:[0-9]{1,5})?$";
