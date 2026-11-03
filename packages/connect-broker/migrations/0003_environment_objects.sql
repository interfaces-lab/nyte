-- Each environment's relay Durable Object now holds its devices, its policy,
-- the proofs its key signed, and when its desktop last leased. D1 keeps what
-- spans environments: the index of links, owners, denied sessions, and link
-- transactions. Devices are not copied: phones enroll again.
DROP TABLE devices;

ALTER TABLE environments DROP COLUMN generation;
ALTER TABLE environments DROP COLUMN policy;
ALTER TABLE environments DROP COLUMN relay_session;
ALTER TABLE environments DROP COLUMN last_seen_at;

-- Owner standing is what Clerk last said through the webhook or the
-- reconcile cron, never a timed copy of a lookup.
ALTER TABLE owners DROP COLUMN checked_at;
