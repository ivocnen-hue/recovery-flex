CREATE TABLE IF NOT EXISTS mapping_cache (
  cache_key TEXT PRIMARY KEY,
  mapper_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
