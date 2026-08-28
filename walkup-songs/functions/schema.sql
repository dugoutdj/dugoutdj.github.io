CREATE TABLE IF NOT EXISTS coaches (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  coach_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  coach_id TEXT NOT NULL,
  shared_team_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  roster_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_coach_idx ON sessions(coach_id);
CREATE INDEX IF NOT EXISTS teams_coach_idx ON teams(coach_id);
