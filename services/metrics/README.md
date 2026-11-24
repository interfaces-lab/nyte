# Nyte metrics

A Cloudflare Worker that counts anonymous installs and opt-in daily usage, and serves the totals as
public JSON at `https://nyte-metrics.daniel-fu90.workers.dev/v1/stats`. It runs on the Workers Free
plan.

## What it stores

Only counters in D1, one row per combination of dimensions per UTC day:

- `installs`: install and update pings by day, kind, version, channel, OS, architecture and client.
- `active`: daily usage reports received, by day, version, channel, OS, architecture and client.
- `usage`: requests, input, output, cache read and cache write tokens, and cost, summed by day,
  provider and model.

A daily cron deletes rows older than 400 days.

## What it never stores

No IP address, header, user agent, `request.cf` location, install or user identifier, request body
or timestamp finer than a UTC day. Nothing is logged, and Workers observability is off because its
logs keep request metadata.

## Endpoints

- `POST /v1/install`: `{ kind, version, channel, os, arch, client }`. Answers 204.
- `POST /v1/usage`: `{ day, version, channel, os, arch, client, models }`. Answers 204.
- `GET /v1/stats`: the last 30 UTC days, today included. The `Stats` type describes it.

A body that fails validation gets 400.

## Set up and deploy

Create the database, then put the id it prints into `database_id` in `wrangler.jsonc`:

```sh
pnpm exec wrangler d1 create nyte-metrics
```

Apply the migrations and deploy:

```sh
pnpm migrate
pnpm run deploy
```

## Query

```sh
pnpm exec wrangler d1 execute nyte-metrics --remote --command "SELECT day, kind, SUM(count) FROM installs GROUP BY day, kind ORDER BY day DESC LIMIT 14"
pnpm exec wrangler d1 execute nyte-metrics --remote --command "SELECT provider, model, SUM(input + output) AS tokens FROM usage GROUP BY provider, model ORDER BY tokens DESC LIMIT 20"
```
