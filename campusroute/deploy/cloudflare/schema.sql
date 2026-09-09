-- D1 schema for the hosted deployment. Additive only: one database serves the
-- live site, so a destructive migration would hit real plans.
CREATE TABLE IF NOT EXISTS plans (
  id            TEXT PRIMARY KEY,
  edit_key_hash TEXT NOT NULL,
  revision      INTEGER NOT NULL DEFAULT 1,
  state         TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
