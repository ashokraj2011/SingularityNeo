-- SingularityNeo Enterprise Control Foundation Schema
-- Phase 1: Identity, Metadata, Execution Lanes, and Segregation of Duties

-- 1. Identity & Entitlement Entities
CREATE TABLE IF NOT EXISTS external_identity_links (
    user_id TEXT NOT NULL REFERENCES workspace_users(id) ON DELETE CASCADE,
    sso_provider TEXT NOT NULL,
    sso_subject_id TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (user_id, sso_provider)
);
CREATE INDEX IF NOT EXISTS idx_external_identity_links_sso ON external_identity_links(sso_provider, sso_subject_id);

CREATE TABLE IF NOT EXISTS directory_group_mappings (
    id TEXT PRIMARY KEY,
    directory_group_name TEXT NOT NULL,
    workspace_role TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_directory_group_mappings ON directory_group_mappings(directory_group_name);

CREATE TABLE IF NOT EXISTS service_account_principals (
    user_id TEXT PRIMARY KEY REFERENCES workspace_users(id) ON DELETE CASCADE,
    description TEXT,
    is_interactive_login_disabled BOOLEAN DEFAULT TRUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segregation_of_duties_policies (
    id TEXT PRIMARY KEY,
    policy_name TEXT NOT NULL,
    description TEXT,
    restricted_action TEXT NOT NULL,
    maker_role TEXT,
    checker_role TEXT,
    prevent_self_approval BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS access_attestation_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES workspace_users(id) ON DELETE CASCADE,
    capability_id TEXT,
    role_attested TEXT NOT NULL,
    attested_by_user_id TEXT NOT NULL,
    attested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_attestation_records_user ON access_attestation_records(user_id);

-- 2. Capability Metadata Entities (Service Profiling)
CREATE TABLE IF NOT EXISTS capability_service_profiles (
    capability_id TEXT PRIMARY KEY REFERENCES capabilities(id) ON DELETE CASCADE,
    business_criticality TEXT DEFAULT 'MEDIUM',
    service_tier TEXT DEFAULT 'Tier 3',
    control_owner_user_id TEXT,
    production_owner_user_id TEXT,
    data_classification TEXT DEFAULT 'INTERNAL',
    rto_rpo_target TEXT,
    updated_at TEXT NOT NULL
);

-- 3. Execution Lane Topology
CREATE TABLE IF NOT EXISTS execution_lanes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    lane_type TEXT NOT NULL, -- 'DESKTOP', 'MANAGED_POOL', 'AUDIT_ONLY'
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_lane_policies (
    id TEXT PRIMARY KEY,
    capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    execution_lane_id TEXT NOT NULL REFERENCES execution_lanes(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(capability_id, execution_lane_id)
);
