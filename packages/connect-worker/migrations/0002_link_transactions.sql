-- A host with no browser linking through a signed-in browser elsewhere. The
-- host opens the transaction under its key's thumbprint; the owner looks the
-- code up, compares the fingerprint, and approves; the host completes with a
-- fresh proof and claims its environment. `(thumbprint, operation_id)` makes a
-- retried open resume the same row. Only one pending row may hold a code.
-- Approval binds exactly one owner and session for `authorization_expires_at`
-- long; every other state carries no binding, so a cancelled or expired row
-- grants nothing. Consumed rows keep the environment they claimed so a host
-- that lost the answer can recover it with its key.
CREATE TABLE link_transactions (
  id TEXT PRIMARY KEY,
  thumbprint TEXT NOT NULL,
  public_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'approved', 'denied', 'expired', 'cancelled', 'consumed')
  ),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  owner_id TEXT,
  session_id TEXT,
  owner_label TEXT,
  approved_at INTEGER,
  authorization_expires_at INTEGER,
  environment_id TEXT REFERENCES environments (id),
  consumed_at INTEGER,
  CHECK (
    (state IN ('approved', 'consumed')) = (
      owner_id IS NOT NULL AND session_id IS NOT NULL AND owner_label IS NOT NULL
      AND approved_at IS NOT NULL AND authorization_expires_at IS NOT NULL
    )
  ),
  CHECK ((state = 'consumed') = (environment_id IS NOT NULL AND consumed_at IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX link_transactions_operation ON link_transactions (thumbprint, operation_id);
CREATE UNIQUE INDEX link_transactions_code ON link_transactions (code_hash) WHERE state = 'pending';
CREATE INDEX link_transactions_by_state ON link_transactions (state, expires_at);
