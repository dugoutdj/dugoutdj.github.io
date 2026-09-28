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

-- Temporary guest-DJ invites: a coach emails a /dj/<token> link that opens a
-- play-only console for 3 days. Only the SHA-256 hash of the token is stored;
-- revoked_at ends a session early, expires_at ends it on schedule.
CREATE TABLE IF NOT EXISTS dj_invites (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER
);

CREATE INDEX IF NOT EXISTS sessions_coach_idx ON sessions(coach_id);
CREATE INDEX IF NOT EXISTS teams_coach_idx ON teams(coach_id);
CREATE INDEX IF NOT EXISTS dj_invites_team_idx ON dj_invites(team_id);
