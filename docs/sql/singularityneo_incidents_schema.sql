-- Incremental incident-attribution schema additions for SingularityNeo.
-- These statements are already included in docs/sql/singularityneo_schema.sql;
-- this file exists as a focused reference for the incident governance feature.

ALTER TABLE capability_evidence_packets
  ADD COLUMN IF NOT EXISTS touched_paths TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_evidence_packets_touched_paths
  ON capability_evidence_packets USING GIN (touched_paths);

CREATE TABLE IF NOT EXISTS capability_incidents (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  source TEXT NOT NULL,
  capability_id TEXT REFERENCES capabilities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  affected_services TEXT[] NOT NULL DEFAULT '{}',
  affected_paths TEXT[] NOT NULL DEFAULT '{}',
  summary TEXT,
  postmortem_url TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_actor_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_incidents_capability_time
  ON capability_incidents (capability_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_source_external
  ON capability_incidents (source, external_id);

CREATE TABLE IF NOT EXISTS capability_incident_packet_links (
  incident_id TEXT NOT NULL REFERENCES capability_incidents(id) ON DELETE CASCADE,
  packet_bundle_id TEXT NOT NULL REFERENCES capability_evidence_packets(bundle_id) ON DELETE CASCADE,
  correlation TEXT NOT NULL,
  correlation_score NUMERIC(5,3),
  correlation_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_by_actor_user_id TEXT,
  linked_by_actor_display_name TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (incident_id, packet_bundle_id)
);

CREATE INDEX IF NOT EXISTS idx_incident_links_packet
  ON capability_incident_packet_links (packet_bundle_id);

CREATE INDEX IF NOT EXISTS idx_incident_links_correlation
  ON capability_incident_packet_links (correlation);

CREATE TABLE IF NOT EXISTS incident_source_configs (
  source TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auth_type TEXT NOT NULL DEFAULT 'HMAC_SHA256',
  secret_reference TEXT,
  basic_username TEXT,
  signature_header TEXT,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incident_service_capability_map (
  service_name TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  default_affected_paths TEXT[] NOT NULL DEFAULT '{}',
  owner_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incident_export_target_configs (
  target TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auth_type TEXT NOT NULL DEFAULT 'API_KEY',
  base_url TEXT,
  secret_reference TEXT,
  basic_username TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capability_incident_jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  incident_id TEXT REFERENCES capability_incidents(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_jobs_status_available
  ON capability_incident_jobs (status, available_at);

CREATE INDEX IF NOT EXISTS idx_incident_jobs_incident
  ON capability_incident_jobs (incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_export_deliveries (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  export_kind TEXT NOT NULL,
  incident_id TEXT REFERENCES capability_incidents(id) ON DELETE SET NULL,
  capability_id TEXT REFERENCES capabilities(id) ON DELETE CASCADE,
  window_days INTEGER,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_status INTEGER,
  response_preview TEXT,
  external_reference TEXT,
  triggered_by_actor_user_id TEXT,
  triggered_by_actor_display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exported_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_export_deliveries_target
  ON incident_export_deliveries (target, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_export_deliveries_incident
  ON incident_export_deliveries (incident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_export_deliveries_capability
  ON incident_export_deliveries (capability_id, created_at DESC);

CREATE TABLE IF NOT EXISTS capability_incident_guardrail_promotions (
  id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL REFERENCES capability_incidents(id) ON DELETE CASCADE,
  packet_bundle_id TEXT NOT NULL REFERENCES capability_evidence_packets(bundle_id) ON DELETE CASCADE,
  concern_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approval_policy_id TEXT,
  approval_wait_id TEXT,
  approval_run_id TEXT,
  requested_by_actor_user_id TEXT,
  requested_by_actor_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_guardrail_promotions_capability
  ON capability_incident_guardrail_promotions (capability_id, created_at DESC);
