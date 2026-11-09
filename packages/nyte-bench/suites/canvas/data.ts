/** Workspace files for the canvas suite: small data sets a person would rather see than read. */

export const SIGNUPS_CSV = [
  "month,free,pro",
  "2026-01,1180,212",
  "2026-02,1245,231",
  "2026-03,1302,248",
  "2026-04,1388,266",
  "2026-05,1451,281",
  "2026-06,1530,297",
  "2026-07,1574,163",
  "2026-08,1640,171",
  "2026-09,1702,236",
  "2026-10,1789,262",
  "2026-11,1853,279",
  "2026-12,1921,301",
  "",
].join("\n");

export const EXPENSES_CSV = [
  "date,category,amount",
  "2026-10-01,Rent,2100.00",
  "2026-10-02,Groceries,86.40",
  "2026-10-03,Transport,42.00",
  "2026-10-05,Subscriptions,15.99",
  "2026-10-06,Eating out,54.20",
  "2026-10-08,Groceries,112.75",
  "2026-10-09,Subscriptions,11.99",
  "2026-10-11,Eating out,38.60",
  "2026-10-12,Transport,42.00",
  "2026-10-14,Travel,389.00",
  "2026-10-15,Groceries,94.10",
  "2026-10-17,Eating out,71.30",
  "2026-10-19,Utilities,128.45",
  "2026-10-20,Transport,42.00",
  "2026-10-22,Groceries,78.95",
  "2026-10-24,Eating out,46.80",
  "2026-10-26,Subscriptions,22.00",
  "2026-10-27,Transport,42.00",
  "2026-10-29,Groceries,101.25",
  "2026-10-31,Eating out,63.15",
  "",
].join("\n");

export const LATENCY_JSON = `${JSON.stringify(
  {
    unit: "ms",
    endpoints: {
      "/login": { v1: { p50: 41, p95: 120 }, v2: { p50: 38, p95: 110 }, v3: { p50: 37, p95: 104 } },
      "/search": {
        v1: { p50: 88, p95: 240 },
        v2: { p50: 82, p95: 228 },
        v3: { p50: 97, p95: 412 },
      },
      "/feed": { v1: { p50: 64, p95: 190 }, v2: { p50: 59, p95: 171 }, v3: { p50: 55, p95: 160 } },
      "/upload": {
        v1: { p50: 210, p95: 640 },
        v2: { p50: 196, p95: 602 },
        v3: { p50: 191, p95: 588 },
      },
      "/settings": { v1: { p50: 22, p95: 61 }, v2: { p50: 21, p95: 58 }, v3: { p50: 21, p95: 57 } },
    },
  },
  null,
  2,
)}\n`;

export const CI_TIMINGS_JSON = `${JSON.stringify(
  {
    run: "main #4812",
    suites: [
      { name: "unit/parser", seconds: 18 },
      { name: "unit/router", seconds: 9 },
      { name: "integration/payments", seconds: 412 },
      { name: "integration/search", seconds: 96 },
      { name: "e2e/checkout", seconds: 655 },
      { name: "e2e/onboarding", seconds: 241 },
      { name: "lint", seconds: 34 },
      { name: "typecheck", seconds: 71 },
    ],
  },
  null,
  2,
)}\n`;

export const README_WITH_TYPO =
  "# Inbox\n\nInbox lets you recieve messages from every channel in one place.\n";
