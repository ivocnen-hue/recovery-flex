CREATE TABLE IF NOT EXISTS audit_sources (
  source_id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES audits(audit_id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  raw_r2_key TEXT NOT NULL,
  parsed_r2_key TEXT NOT NULL,
  source_rows INTEGER NOT NULL,
  sheets INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_sources_audit
  ON audit_sources(audit_id, created_at);
