PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS audits (
  audit_id TEXT PRIMARY KEY,
  seller TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  period TEXT NOT NULL,
  status TEXT NOT NULL,
  source_rows INTEGER NOT NULL,
  findings INTEGER NOT NULL,
  total_recoverable REAL,
  summary_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  errors_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  finding_id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES audits(audit_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  recoverable_amount REAL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  evidence_id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES audits(audit_id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL REFERENCES findings(finding_id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS findings_audit_status
  ON findings(audit_id, status);
CREATE INDEX IF NOT EXISTS evidence_audit
  ON evidence(audit_id, finding_id);

