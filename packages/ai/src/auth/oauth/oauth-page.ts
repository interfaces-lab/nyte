/**
 * Self-contained HTML pages served by the localhost OAuth callback servers
 * (success and failure), rendered as plain strings with escaped content.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/auth/oauth/oauth-page.ts
 * Synced with pi 7ebf9087e.
 */

// Nyte divergence: pi's page is a dark, centered layout with the pi logo. This
// one follows the Nyte landing language (paper/ink, hairline rules with corner
// ticks, square corners), picks light or dark from the OS, and carries the
// provider name in the heading. No mark yet, one system font, no JS, no
// network: the page has to work offline and load from nothing but this string.

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPage(options: {
  kind: "success" | "error";
  status: string;
  heading: string;
  message: string;
  footer: string;
  details?: string;
}): string {
  const heading = escapeHtml(options.heading);
  const status = escapeHtml(options.status);
  const message = escapeHtml(options.message);
  const footer = escapeHtml(options.footer);
  const details = options.details ? escapeHtml(options.details) : undefined;
  const isError = options.kind === "error";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${heading} · Nyte</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #eeeeee;
      --card: #fcfcfc;
      --ink: #141414;
      --dim: #767676;
      --rule: #a5a5a533;
      --tick: #a5a5a5;
      --ok: #378e23;
      --err: #c3691e;
      --wash: #26262608;
      --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #141414;
        --card: #1c1c1c;
        --ink: #e1e1e1;
        --dim: #8a8a8a;
        --rule: #58585899;
        --tick: #585858;
        --ok: #9ece6a;
        --err: #ff9e64;
        --wash: #e1e1e10a;
      }
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--bg);
      color: var(--ink);
      font-family: var(--font);
      -webkit-font-smoothing: antialiased;
    }
    main {
      width: 100%;
      max-width: 640px;
      background: var(--card);
      border: 1px solid var(--rule);
      position: relative;
    }
    main::before, main::after {
      content: "";
      position: absolute;
      top: -1px;
      width: 1px;
      height: 14px;
      background: var(--tick);
    }
    main::before { left: -1px; }
    main::after { right: -1px; }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 24px;
      border-bottom: 1px solid var(--rule);
      font-size: 13px;
      line-height: 1;
      color: var(--dim);
    }
    .brand { color: var(--ink); font-weight: 500; }
    .status { display: flex; align-items: center; gap: 7px; }
    .status::before {
      content: "";
      width: 7px;
      height: 7px;
      background: var(--ok);
    }
    .status.err::before { background: var(--err); }
    section { padding: 36px 24px 32px; }
    h1 {
      margin: 0 0 12px;
      font-size: 26px;
      line-height: 1.15;
      font-weight: 400;
      letter-spacing: -0.02em;
      text-wrap: balance;
    }
    p {
      margin: 0;
      font-size: 16px;
      line-height: 1.5;
      max-width: 48ch;
      color: var(--dim);
      text-wrap: pretty;
    }
    .details {
      margin: 20px -24px -32px;
      padding: 14px 24px;
      border-top: 1px solid var(--rule);
      background: var(--wash);
      font-size: 13px;
      line-height: 1.5;
      color: var(--dim);
      white-space: pre-wrap;
      word-break: break-word;
    }
    footer {
      padding: 12px 24px;
      border-top: 1px solid var(--rule);
      font-size: 13px;
      color: var(--dim);
    }
  </style>
</head>
<body>
  <main data-kind="${options.kind}">
    <header>
      <div class="brand">Nyte</div>
      <div class="status${isError ? " err" : ""}">${status}</div>
    </header>
    <section>
      <h1>${heading}</h1>
      <p>${message}</p>
      ${details ? `<div class="details">${details}</div>` : ""}
    </section>
    <footer>${footer}</footer>
  </main>
</body>
</html>`;
}

export function oauthSuccessHtml(options: { provider: string }): string {
  return renderPage({
    kind: "success",
    status: "Signed in",
    heading: `Signed in to ${options.provider}`,
    message: "Nyte received the callback and is finishing up. You can close this tab.",
    footer: "Return to the terminal.",
  });
}

export function oauthErrorHtml(message: string, details?: string): string {
  return renderPage({
    kind: "error",
    status: "Not signed in",
    heading: "Sign-in did not complete",
    message,
    footer: "The terminal has the full error.",
    details,
  });
}
