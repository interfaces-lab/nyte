CREATE TABLE installs (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('install', 'update')),
  version TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('stable', 'nightly')),
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  client TEXT NOT NULL CHECK (client IN ('desktop', 'tui')),
  count INTEGER NOT NULL,
  PRIMARY KEY (day, kind, version, channel, os, arch, client)
) STRICT, WITHOUT ROWID;

CREATE TABLE active (
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('stable', 'nightly')),
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  client TEXT NOT NULL CHECK (client IN ('desktop', 'tui')),
  count INTEGER NOT NULL,
  PRIMARY KEY (day, version, channel, os, arch, client)
) STRICT, WITHOUT ROWID;

CREATE TABLE usage (
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  requests INTEGER NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  cost REAL NOT NULL,
  PRIMARY KEY (day, provider, model)
) STRICT, WITHOUT ROWID;
