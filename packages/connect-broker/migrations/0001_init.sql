-- Clerk users the broker has heard about. A missing row is an active owner.
-- `disabled` is banned or locked; `deleted` is terminal. `version` is the Clerk
-- `updated_at` (ms) behind the status; older news never applies. `checked_at`
-- is the last Clerk Backend API lookup that answered.
CREATE TABLE owners (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'deleted')),
  version INTEGER NOT NULL,
  checked_at INTEGER
) STRICT;

-- One linked desktop. A revoked row is a tombstone: it never becomes active
-- again, and its key and id are never reused.
-- `generation` grows with each lifecycle change (revocation); `policy` grows
-- with that and with every device activation or revocation.
-- `relay_session` names the relay socket that proved this environment's key,
-- and is cleared when that socket closes.
CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  thumbprint TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'revoked')),
  generation INTEGER NOT NULL CHECK (generation >= 1),
  policy INTEGER NOT NULL CHECK (policy >= 1),
  relay_session TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
) STRICT;

CREATE INDEX environments_by_owner ON environments (owner_id, state);

-- A phone's device digest for one environment. Reserved before the broker
-- relays the enrollment, active only after the desktop's signed receipt.
-- A revoked row is a tombstone and never becomes active again; its reason says
-- who ended it: `revoked` (owner or desktop, session denied), `released` (the
-- phone dropped it), `replaced` (same client enrolled again), `unconfirmed`
-- (the desktop never confirmed), `expired` (grant lapsed), `environment`.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL REFERENCES environments (id),
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  digest TEXT NOT NULL,
  session_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'active', 'revoked')),
  revoke_reason TEXT CHECK (
    revoke_reason IN ('revoked', 'released', 'replaced', 'unconfirmed', 'expired', 'environment')
  ),
  grant_id TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  grant_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK ((state = 'revoked') = (revoke_reason IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX devices_active_client ON devices (environment_id, client_id) WHERE state = 'active';
CREATE INDEX devices_by_environment ON devices (environment_id, state);
CREATE INDEX devices_by_digest ON devices (environment_id, digest);
CREATE INDEX devices_by_grant_expiry ON devices (state, grant_expires_at);

-- Clerk sessions that enrolled a revoked device. The broker refuses them and
-- retries revoking them in Clerk. A row is kept until Clerk confirms the
-- revocation and every JWT minted before it has expired (`expires_at`);
-- until then `expires_at` is null and the row never lapses.
CREATE TABLE denied_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  denied_at INTEGER NOT NULL,
  clerk_revoked_at INTEGER,
  expires_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL
) STRICT;

CREATE INDEX denied_sessions_pending ON denied_sessions (clerk_revoked_at, next_attempt_at);

-- Consumed desktop proof ids, kept until the proof could no longer verify.
CREATE TABLE proof_replays (
  key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
) STRICT;

-- Fixed-window request counters.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
) STRICT;
