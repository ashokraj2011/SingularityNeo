import { Pool, PoolClient, QueryResult } from 'pg';
import dotenv from 'dotenv';
import type {
  EmbeddingProviderKey,
  MemoryRetrievalMode,
  WorkspaceDatabaseBootstrapConfig,
  WorkspaceDatabaseBootstrapStatus,
} from '../src/types';
import { isLocalOpenAIConfigured } from './localOpenAIProvider';

// DB config is derived at module load time, so load the local env files before
// `createRuntimeDatabaseConfig()` snapshots process.env. Otherwise server-side
// imports that touch `db.ts` before `startServer.ts` runs would silently fall
// back to the built-in defaults (for example `singularity` instead of the
// saved PGDATABASE from `.env.local`).
dotenv.config({ path: '.env.local' });
dotenv.config();

type RuntimeDatabaseConfig = Required<
  Omit<WorkspaceDatabaseBootstrapConfig, 'password'>
> & {
  password?: string;
};

const toOptionalSecret = (value?: string | null) => {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : undefined;
};

const toNumberOrDefault = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const createRuntimeDatabaseConfig = (
  overrides: Partial<WorkspaceDatabaseBootstrapConfig> = {},
): RuntimeDatabaseConfig => ({
  host: String(overrides.host ?? process.env.PGHOST ?? '127.0.0.1').trim() || '127.0.0.1',
  port: toNumberOrDefault(overrides.port ?? process.env.PGPORT, 5432),
  databaseName:
    String(overrides.databaseName ?? process.env.PGDATABASE ?? 'singularity').trim() ||
    'singularity',
  user:
    String(overrides.user ?? process.env.PGUSER ?? process.env.USER ?? 'postgres').trim() ||
    'postgres',
  password:
    overrides.password !== undefined
      ? toOptionalSecret(overrides.password)
      : toOptionalSecret(process.env.PGPASSWORD),
  adminDatabaseName:
    String(overrides.adminDatabaseName ?? process.env.PGADMIN_DATABASE ?? 'postgres').trim() ||
    'postgres',
});

const MEMORY_EMBEDDING_DIMENSIONS = 64;
const platformFeatureState = {
  pgvectorAvailable: false,
};

export const getMemoryRetrievalDiagnostics = (): {
  retrievalMode: MemoryRetrievalMode;
  embeddingConfigured: boolean;
  embeddingProviderKey: EmbeddingProviderKey;
  fallbackReason?: string;
} => {
  const embeddingConfigured = isLocalOpenAIConfigured();
  if (!embeddingConfigured) {
    return {
      retrievalMode: 'deterministic-hash',
      embeddingConfigured: false,
      embeddingProviderKey: 'deterministic-hash',
      fallbackReason: 'Local embedding provider is not configured.',
    };
  }
  if (platformFeatureState.pgvectorAvailable) {
    return {
      retrievalMode: 'pgvector',
      embeddingConfigured: true,
      embeddingProviderKey: 'local-openai',
    };
  }
  return {
    retrievalMode: 'json-cosine',
    embeddingConfigured: true,
    embeddingProviderKey: 'local-openai',
    fallbackReason: 'pgvector is not available; using JSON cosine retrieval fallback.',
  };
};

let runtimeDatabaseConfig = createRuntimeDatabaseConfig();
let lastDatabaseConnectionError: string | null = null;
let poolPromise: Promise<Pool> | null = null;

const getSafeDatabaseName = (value = runtimeDatabaseConfig.databaseName) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsupported database name "${value}".`);
  }

  return value;
};

const getSafeAdminDatabaseName = (value = runtimeDatabaseConfig.adminDatabaseName) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsupported admin database name "${value}".`);
  }

  return value;
};

const getConnectionConfig = (config: RuntimeDatabaseConfig = runtimeDatabaseConfig) => ({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
});

export const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS capabilities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      domain TEXT,
      parent_capability_id TEXT REFERENCES capabilities(id) ON DELETE SET NULL,
      capability_kind TEXT NOT NULL DEFAULT 'DELIVERY',
      collection_kind TEXT,
      business_unit TEXT,
      owner_team TEXT,
      business_outcome TEXT,
      success_metrics TEXT[] NOT NULL DEFAULT '{}',
      definition_of_done TEXT,
      required_evidence_kinds TEXT[] NOT NULL DEFAULT '{}',
      operating_policy_summary TEXT,
      confluence_link TEXT,
      jira_board_link TEXT,
      documentation_notes TEXT,
      applications TEXT[] NOT NULL DEFAULT '{}',
      apis TEXT[] NOT NULL DEFAULT '{}',
      databases TEXT[] NOT NULL DEFAULT '{}',
      database_configs JSONB NOT NULL DEFAULT '[]'::jsonb,
      git_repositories TEXT[] NOT NULL DEFAULT '{}',
      local_directories TEXT[] NOT NULL DEFAULT '{}',
      team_names TEXT[] NOT NULL DEFAULT '{}',
      stakeholders JSONB NOT NULL DEFAULT '[]'::jsonb,
      additional_metadata JSONB NOT NULL DEFAULT '[]'::jsonb,
      contract_draft JSONB NOT NULL DEFAULT '{}'::jsonb,
      lifecycle JSONB NOT NULL DEFAULT '{}'::jsonb,
      phase_ownership_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
      execution_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL,
      special_agent_id TEXT,
      is_system_capability BOOLEAN NOT NULL DEFAULT FALSE,
      system_capability_role TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS workspace_settings (
      id TEXT PRIMARY KEY,
      database_configs JSONB NOT NULL DEFAULT '[]'::jsonb,
      connector_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      foundation_agent_templates JSONB NOT NULL DEFAULT '[]'::jsonb,
      foundation_workflow_templates JSONB NOT NULL DEFAULT '[]'::jsonb,
      foundation_eval_suite_templates JSONB NOT NULL DEFAULT '[]'::jsonb,
      foundation_skill_templates JSONB NOT NULL DEFAULT '[]'::jsonb,
      foundation_artifact_templates JSONB NOT NULL DEFAULT '[]'::jsonb,
      foundation_tool_templates JSONB NOT NULL DEFAULT '[]'::jsonb,
      foundations_initialized_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_repositories (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      local_root_hint TEXT,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_dependencies (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      target_capability_id TEXT NOT NULL,
      dependency_kind TEXT NOT NULL,
      description TEXT NOT NULL,
      criticality TEXT NOT NULL DEFAULT 'MEDIUM',
      version_constraint TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_shared_references (
      collection_capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      member_capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      label TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (collection_capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_published_snapshots (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      publish_version INTEGER NOT NULL,
      published_at TIMESTAMPTZ NOT NULL,
      published_by TEXT NOT NULL,
      supersedes_snapshot_id TEXT,
      snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS workspace_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      team_ids TEXT[] NOT NULL DEFAULT '{}',
      workspace_roles TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS workspace_teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      member_user_ids TEXT[] NOT NULL DEFAULT '{}',
      capability_ids TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS workspace_memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES workspace_users(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES workspace_teams(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_memberships (
      id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES workspace_users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES workspace_teams(id) ON DELETE SET NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_grants (
      id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES workspace_users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES workspace_teams(id) ON DELETE CASCADE,
      actions TEXT[] NOT NULL DEFAULT '{}',
      note TEXT,
      created_by_user_id TEXT REFERENCES workspace_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_descendant_access_grants (
      id TEXT PRIMARY KEY,
      parent_capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      descendant_capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES workspace_users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES workspace_teams(id) ON DELETE CASCADE,
      actions TEXT[] NOT NULL DEFAULT '{}',
      note TEXT,
      created_by_user_id TEXT REFERENCES workspace_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS workspace_external_identity_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES workspace_users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      username TEXT,
      display_name TEXT,
      profile_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS access_audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES workspace_users(id) ON DELETE SET NULL,
      actor_display_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      capability_id TEXT REFERENCES capabilities(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS workspace_user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES workspace_users(id) ON DELETE CASCADE,
      default_capability_id TEXT REFERENCES capabilities(id) ON DELETE SET NULL,
      last_selected_team_id TEXT REFERENCES workspace_teams(id) ON DELETE SET NULL,
      workbench_view TEXT NOT NULL DEFAULT 'MY_QUEUE',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS workspace_notification_rules (
      id TEXT PRIMARY KEY,
      trigger TEXT NOT NULL,
      channels JSONB NOT NULL DEFAULT '[]'::jsonb,
      team_id TEXT REFERENCES workspace_teams(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES workspace_users(id) ON DELETE CASCADE,
      capability_id TEXT REFERENCES capabilities(id) ON DELETE CASCADE,
      immediate BOOLEAN NOT NULL DEFAULT TRUE,
      digest BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_workspaces (
      capability_id TEXT PRIMARY KEY REFERENCES capabilities(id) ON DELETE CASCADE,
      active_chat_agent_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS desktop_executor_registrations (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES workspace_users(id) ON DELETE SET NULL,
      actor_display_name TEXT NOT NULL,
      actor_team_ids TEXT[] NOT NULL DEFAULT '{}',
      owned_capability_ids TEXT[] NOT NULL DEFAULT '{}',
      approved_workspace_roots JSONB NOT NULL DEFAULT '{}'::jsonb,
      runtime_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      working_directory TEXT,
      heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS desktop_user_workspace_mappings (
      id TEXT PRIMARY KEY,
      executor_id TEXT NOT NULL REFERENCES desktop_executor_registrations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES workspace_users(id) ON DELETE CASCADE,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      repository_id TEXT,
      local_root_path TEXT NOT NULL,
      working_directory_path TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_execution_ownership (
      capability_id TEXT PRIMARY KEY REFERENCES capabilities(id) ON DELETE CASCADE,
      executor_id TEXT NOT NULL REFERENCES desktop_executor_registrations(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES workspace_users(id) ON DELETE SET NULL,
      actor_display_name TEXT NOT NULL,
      actor_team_ids TEXT[] NOT NULL DEFAULT '{}',
      approved_workspace_roots TEXT[] NOT NULL DEFAULT '{}',
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_workspace_write_locks (
      capability_id TEXT PRIMARY KEY REFERENCES capabilities(id) ON DELETE CASCADE,
      run_step_id   TEXT NOT NULL,
      run_id        TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      step_name     TEXT NOT NULL DEFAULT '',
      acquired_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_skills (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      version TEXT NOT NULL,
      content_markdown TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'CUSTOM',
      origin TEXT NOT NULL DEFAULT 'CAPABILITY',
      default_template_keys TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_agents (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      objective TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      initialization_status TEXT NOT NULL,
      documentation_sources TEXT[] NOT NULL DEFAULT '{}',
      input_artifacts TEXT[] NOT NULL DEFAULT '{}',
      output_artifacts TEXT[] NOT NULL DEFAULT '{}',
      is_owner BOOLEAN NOT NULL DEFAULT FALSE,
      is_built_in BOOLEAN NOT NULL DEFAULT FALSE,
      role_starter_key TEXT,
      learning_notes TEXT[] NOT NULL DEFAULT '{}',
      contract JSONB NOT NULL DEFAULT '{}'::jsonb,
      skill_ids TEXT[] NOT NULL DEFAULT '{}',
      preferred_tool_ids TEXT[] NOT NULL DEFAULT '{}',
      provider TEXT NOT NULL,
      provider_key TEXT,
      embedding_provider_key TEXT,
      model TEXT NOT NULL,
      token_limit INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_agent_learning_profiles (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'NOT_STARTED',
      summary TEXT NOT NULL DEFAULT '',
      highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
      context_block TEXT NOT NULL DEFAULT '',
      source_document_ids TEXT[] NOT NULL DEFAULT '{}',
      source_artifact_ids TEXT[] NOT NULL DEFAULT '{}',
      source_count INTEGER NOT NULL DEFAULT 0,
      derivation_mode TEXT,
      derived_from_agent_id TEXT,
      source_version_id TEXT,
      refreshed_at TIMESTAMPTZ,
      last_requested_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, agent_id),
      FOREIGN KEY (capability_id, agent_id)
        REFERENCES capability_agents(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_agent_learning_jobs (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      request_reason TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, agent_id)
        REFERENCES capability_agents(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_agent_sessions (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      scope_id TEXT NOT NULL DEFAULT '',
      session_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      model TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, agent_id)
        REFERENCES capability_agents(capability_id, id)
        ON DELETE CASCADE,
      UNIQUE (capability_id, agent_id, scope, scope_id, fingerprint)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_messages (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      agent_id TEXT,
      agent_name TEXT,
      trace_id TEXT,
      model TEXT,
      session_id TEXT,
      session_scope TEXT,
      session_scope_id TEXT,
      work_item_id TEXT,
      run_id TEXT,
      workflow_step_id TEXT,
      hidden BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_agent_session_memories (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      scope_id TEXT NOT NULL DEFAULT '',
      session_id TEXT NOT NULL,
      rolling_summary TEXT NOT NULL DEFAULT '',
      salient_turns JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_user_intent TEXT,
      last_assistant_actionable_offer TEXT,
      recent_repo_code_target TEXT,
      request_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, agent_id)
        REFERENCES capability_agents(capability_id, id)
        ON DELETE CASCADE,
      UNIQUE (capability_id, agent_id, scope, scope_id, session_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_workflows (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      workflow_type TEXT,
      scope TEXT NOT NULL DEFAULT 'CAPABILITY',
      summary TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1,
      entry_node_id TEXT,
      nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
      edges JSONB NOT NULL DEFAULT '[]'::jsonb,
      steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      publish_state TEXT NOT NULL DEFAULT 'DRAFT',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_artifacts (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      inputs TEXT[] NOT NULL DEFAULT '{}',
      version TEXT NOT NULL,
      agent TEXT NOT NULL,
      created TEXT NOT NULL,
      template TEXT,
      template_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      documentation_status TEXT,
      is_learning_artifact BOOLEAN,
      is_master_artifact BOOLEAN,
      decisions TEXT[] NOT NULL DEFAULT '{}',
      changes TEXT[] NOT NULL DEFAULT '{}',
      learning_insights TEXT[] NOT NULL DEFAULT '{}',
      governance_rules TEXT[] NOT NULL DEFAULT '{}',
      description TEXT,
      direction TEXT,
      connected_agent_id TEXT,
      source_workflow_id TEXT,
      workflow_step_id TEXT,
      work_item_id TEXT,
      artifact_kind TEXT,
      phase TEXT,
      source_run_id TEXT,
      source_run_step_id TEXT,
      source_wait_id TEXT,
      handoff_from_agent_id TEXT,
      handoff_to_agent_id TEXT,
      content_format TEXT,
      mime_type TEXT,
      file_name TEXT,
      content_text TEXT,
      content_json JSONB,
      downloadable BOOLEAN NOT NULL DEFAULT FALSE,
      trace_id TEXT,
      latency_ms INTEGER,
      cost_usd NUMERIC(12,6),
      policy_decision_id TEXT,
      retrieval_references JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_artifact_files (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      artifact_id TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, artifact_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_evidence_packets (
      bundle_id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL,
      run_id TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      digest_sha256 TEXT NOT NULL UNIQUE,
      payload JSONB NOT NULL,
      generated_by_actor_user_id TEXT,
      generated_by_actor_display_name TEXT NOT NULL,
      touched_paths TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
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
    )
  `,
  `
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
    )
  `,
  `
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
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS incident_service_capability_map (
      service_name TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      default_affected_paths TEXT[] NOT NULL DEFAULT '{}',
      owner_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
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
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_incident_jobs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      incident_id TEXT REFERENCES capability_incidents(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
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
    )
  `,
  `
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
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_tasks (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      agent TEXT NOT NULL,
      work_item_id TEXT,
      workflow_id TEXT,
      workflow_step_id TEXT,
      managed_by_workflow BOOLEAN NOT NULL DEFAULT FALSE,
      task_type TEXT,
      phase TEXT,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      prompt TEXT,
      execution_notes TEXT,
      run_id TEXT,
      run_step_id TEXT,
      tool_invocation_id TEXT,
      task_subtype TEXT,
      parent_task_id TEXT,
      parent_run_id TEXT,
      parent_run_step_id TEXT,
      delegated_agent_id TEXT,
      handoff_packet_id TEXT,
      linked_artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
      produced_outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_execution_logs (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      run_id TEXT,
      run_step_id TEXT,
      tool_invocation_id TEXT,
      trace_id TEXT,
      latency_ms INTEGER,
      cost_usd NUMERIC(12,6),
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_learning_updates (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      source_log_ids TEXT[] NOT NULL DEFAULT '{}',
      insight TEXT NOT NULL,
      skill_update TEXT,
      timestamp TEXT NOT NULL,
      trigger_type TEXT,
      related_work_item_id TEXT,
      related_run_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_work_items (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      task_type TEXT,
      parent_work_item_id TEXT,
      story_points INTEGER,
      t_shirt_size TEXT,
      sizing_confidence TEXT,
      planning_batch_id TEXT,
      planning_proposal_item_id TEXT,
      phase_stakeholders JSONB NOT NULL DEFAULT '[]'::jsonb,
      phase TEXT NOT NULL,
      phase_owner_team_id TEXT,
      claim_owner_user_id TEXT,
      watched_by_user_ids TEXT[] NOT NULL DEFAULT '{}',
      pending_handoff JSONB,
      workflow_id TEXT NOT NULL,
      current_step_id TEXT,
      assigned_agent_id TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      tags TEXT[] NOT NULL DEFAULT '{}',
      pending_request JSONB,
      blocker JSONB,
      active_run_id TEXT,
      last_run_id TEXT,
      stage_overrides JSONB NOT NULL DEFAULT '[]'::jsonb,
      record_version INTEGER NOT NULL DEFAULT 1,
      history JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_story_proposal_batches (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      source_prompt TEXT,
      selected_workflow_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
      dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
      risks JSONB NOT NULL DEFAULT '[]'::jsonb,
      sizing_policy TEXT NOT NULL,
      generated_by_agent_id TEXT,
      generation_mode TEXT NOT NULL DEFAULT 'FALLBACK',
      planning_artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_story_proposal_items (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      parent_item_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      business_outcome TEXT,
      acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
      dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
      risks JSONB NOT NULL DEFAULT '[]'::jsonb,
      recommended_workflow_id TEXT NOT NULL,
      recommended_task_type TEXT,
      story_points INTEGER,
      t_shirt_size TEXT,
      sizing_confidence TEXT,
      sizing_rationale TEXT,
      implementation_notes TEXT,
      tags TEXT[] NOT NULL DEFAULT '{}',
      review_state TEXT NOT NULL DEFAULT 'PROPOSED',
      sort_order INTEGER NOT NULL DEFAULT 0,
      promoted_work_item_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, batch_id, id),
      FOREIGN KEY (capability_id, batch_id)
        REFERENCES capability_story_proposal_batches(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_story_proposal_decisions (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      id TEXT NOT NULL,
      item_id TEXT,
      disposition TEXT NOT NULL,
      actor_user_id TEXT,
      actor_display_name TEXT NOT NULL,
      note TEXT,
      field_changes JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, batch_id, id),
      FOREIGN KEY (capability_id, batch_id)
        REFERENCES capability_story_proposal_batches(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_work_item_repository_assignments (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      role TEXT NOT NULL,
      checkout_required BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, work_item_id, repository_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_work_item_branches (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      shared_branch TEXT NOT NULL,
      created_by_user_id TEXT,
      head_sha TEXT,
      linked_pr_url TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_work_item_code_claims (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_id TEXT,
      claim_type TEXT NOT NULL,
      status TEXT NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      released_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, work_item_id, claim_type)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_work_item_checkout_sessions (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      local_path TEXT,
      branch TEXT NOT NULL,
      last_seen_head_sha TEXT,
      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, work_item_id, user_id, repository_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS desktop_work_item_checkout_sessions (
      executor_id TEXT NOT NULL REFERENCES desktop_executor_registrations(id) ON DELETE CASCADE,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES workspace_users(id) ON DELETE CASCADE,
      repository_id TEXT NOT NULL,
      local_path TEXT,
      working_directory_path TEXT,
      branch TEXT NOT NULL,
      last_seen_head_sha TEXT,
      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (executor_id, capability_id, work_item_id, user_id, repository_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_work_item_handoff_packets (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      from_user_id TEXT,
      to_user_id TEXT,
      from_team_id TEXT,
      to_team_id TEXT,
      summary TEXT NOT NULL,
      open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      blocking_dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
      recommended_next_step TEXT,
      artifact_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      trace_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      delegation_origin_task_id TEXT,
      delegation_origin_agent_id TEXT,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_workflow_runs (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      queue_reason TEXT,
      assigned_executor_id TEXT,
      attempt_number INTEGER NOT NULL,
      workflow_snapshot JSONB NOT NULL,
      current_node_id TEXT,
      current_step_id TEXT,
      current_phase TEXT,
      assigned_agent_id TEXT,
      branch_state JSONB NOT NULL DEFAULT '{}'::jsonb,
      pause_reason TEXT,
      current_wait_id TEXT,
      terminal_outcome TEXT,
      restart_from_phase TEXT,
      trace_id TEXT,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_workflow_run_steps (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      workflow_node_id TEXT NOT NULL,
      workflow_step_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      phase TEXT NOT NULL,
      name TEXT NOT NULL,
      step_type TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      span_id TEXT,
      evidence_summary TEXT,
      output_summary TEXT,
      wait_id TEXT,
      last_tool_invocation_id TEXT,
      retrieval_references JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, run_id)
        REFERENCES capability_workflow_runs(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_tool_invocations (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      run_step_id TEXT NOT NULL,
      trace_id TEXT,
      span_id TEXT,
      tool_id TEXT NOT NULL,
      status TEXT NOT NULL,
      request JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_summary TEXT,
      working_directory TEXT,
      exit_code INTEGER,
      stdout_preview TEXT,
      stderr_preview TEXT,
      retryable BOOLEAN NOT NULL DEFAULT FALSE,
      sandbox_profile TEXT,
      policy_decision_id TEXT,
      latency_ms INTEGER,
      cost_usd NUMERIC(12,6),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, run_id)
        REFERENCES capability_workflow_runs(capability_id, id)
        ON DELETE CASCADE,
      FOREIGN KEY (capability_id, run_step_id)
        REFERENCES capability_workflow_run_steps(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_run_events (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      trace_id TEXT,
      span_id TEXT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      run_step_id TEXT,
      tool_invocation_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, run_id)
        REFERENCES capability_workflow_runs(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_run_waits (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      run_step_id TEXT NOT NULL,
      trace_id TEXT,
      span_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_by_actor_user_id TEXT,
      requested_by_actor_team_ids TEXT[] NOT NULL DEFAULT '{}',
      resolution TEXT,
      resolved_by TEXT,
      resolved_by_actor_user_id TEXT,
      resolved_by_actor_team_ids TEXT[] NOT NULL DEFAULT '{}',
      approval_policy_id TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, run_id)
        REFERENCES capability_workflow_runs(capability_id, id)
        ON DELETE CASCADE,
      FOREIGN KEY (capability_id, run_step_id)
        REFERENCES capability_workflow_run_steps(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_approval_assignments (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      wait_id TEXT NOT NULL,
      phase TEXT,
      step_name TEXT,
      approval_policy_id TEXT,
      status TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      assigned_user_id TEXT,
      assigned_team_id TEXT,
      due_at TIMESTAMPTZ,
      delegated_to_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_approval_decisions (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      wait_id TEXT NOT NULL,
      assignment_id TEXT,
      disposition TEXT NOT NULL,
      actor_user_id TEXT,
      actor_display_name TEXT NOT NULL,
      actor_team_ids TEXT[] NOT NULL DEFAULT '{}',
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_work_item_claims (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_id TEXT,
      status TEXT NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      released_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, work_item_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_work_item_presence (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_id TEXT,
      view_context TEXT,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, work_item_id, user_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_ownership_transfers (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      from_phase TEXT,
      to_phase TEXT NOT NULL,
      from_team_id TEXT,
      to_team_id TEXT,
      transferred_by_user_id TEXT,
      transferred_by_name TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_phase_handoffs (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      from_phase TEXT NOT NULL,
      to_phase TEXT NOT NULL,
      from_team_id TEXT,
      to_team_id TEXT,
      acceptance_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
      open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      blocking_dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
      receiving_team_accepted_at TIMESTAMPTZ,
      receiving_team_accepted_by_user_id TEXT,
      summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_trace_spans (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      parent_span_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      model TEXT,
      cost_usd NUMERIC(12,6),
      token_usage JSONB,
      attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_metric_samples (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      trace_id TEXT,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      metric_value DOUBLE PRECISION NOT NULL,
      unit TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '{}'::jsonb,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_policy_decisions (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      trace_id TEXT,
      run_id TEXT,
      run_step_id TEXT,
      tool_invocation_id TEXT,
      action_type TEXT NOT NULL,
      target_id TEXT,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      requested_by_agent_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS governance_controls (
      control_id     TEXT PRIMARY KEY,
      framework      TEXT NOT NULL,
      control_code   TEXT NOT NULL,
      control_family TEXT NOT NULL,
      title          TEXT NOT NULL,
      description    TEXT NOT NULL,
      owner_role     TEXT,
      severity       TEXT NOT NULL DEFAULT 'STANDARD',
      status         TEXT NOT NULL DEFAULT 'ACTIVE',
      seed_version   TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (framework, control_code)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS governance_control_bindings (
      binding_id       TEXT PRIMARY KEY,
      control_id       TEXT NOT NULL REFERENCES governance_controls(control_id) ON DELETE CASCADE,
      policy_selector  JSONB NOT NULL DEFAULT '{}'::jsonb,
      binding_kind     TEXT NOT NULL,
      capability_scope TEXT,
      seed_version     TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by       TEXT
    )
  `,
  // Slice 3 — exception lifecycle. An exception is a time-bound, auditable
  // waiver of a policy decision: the REQUIRE_APPROVAL path flips to ALLOW
  // while an active exception matches. Every state transition is recorded
  // on governance_exception_events for the audit trail.
  `
    CREATE TABLE IF NOT EXISTS governance_exceptions (
      exception_id     TEXT PRIMARY KEY,
      capability_id    TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      control_id       TEXT NOT NULL REFERENCES governance_controls(control_id),
      requested_by     TEXT NOT NULL,
      requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reason           TEXT NOT NULL,
      scope_selector   JSONB NOT NULL DEFAULT '{}'::jsonb,
      status           TEXT NOT NULL DEFAULT 'REQUESTED',
      decided_by       TEXT,
      decided_at       TIMESTAMPTZ,
      decision_comment TEXT,
      expires_at       TIMESTAMPTZ,
      revoked_at       TIMESTAMPTZ,
      revoked_by       TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS governance_exception_events (
      event_id        TEXT PRIMARY KEY,
      exception_id    TEXT NOT NULL REFERENCES governance_exceptions(exception_id) ON DELETE CASCADE,
      event_type      TEXT NOT NULL,
      actor_user_id   TEXT,
      details         JSONB NOT NULL DEFAULT '{}'::jsonb,
      at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_memory_documents (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      tier TEXT NOT NULL,
      source_id TEXT,
      source_uri TEXT,
      freshness TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      content_preview TEXT NOT NULL,
      is_global BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_memory_chunks (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, document_id)
        REFERENCES capability_memory_documents(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_memory_embeddings (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      vector_model TEXT NOT NULL,
      embedding_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, document_id)
        REFERENCES capability_memory_documents(capability_id, id)
        ON DELETE CASCADE,
      FOREIGN KEY (capability_id, chunk_id)
        REFERENCES capability_memory_chunks(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_eval_suites (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      agent_role TEXT NOT NULL,
      eval_type TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_eval_cases (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      suite_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      input JSONB NOT NULL DEFAULT '{}'::jsonb,
      expected JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, suite_id)
        REFERENCES capability_eval_suites(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_eval_runs (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      suite_id TEXT NOT NULL,
      status TEXT NOT NULL,
      trace_id TEXT,
      judge_model TEXT,
      score DOUBLE PRECISION,
      summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, suite_id)
        REFERENCES capability_eval_suites(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_eval_run_results (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      eval_run_id TEXT NOT NULL,
      eval_case_id TEXT NOT NULL,
      status TEXT NOT NULL,
      score DOUBLE PRECISION NOT NULL,
      summary TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, eval_run_id)
        REFERENCES capability_eval_runs(capability_id, id)
        ON DELETE CASCADE,
      FOREIGN KEY (capability_id, eval_case_id)
        REFERENCES capability_eval_cases(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  // ────────────────────────────────────────────────────────────────────
  // Copilot guidance pack — per-capability ingestion of repo-authored
  // copilot/AI-assistant files (CLAUDE.md, AGENTS.md, .cursor/rules/*,
  // .github/copilot-instructions.md, docs/testing.md, …). Read at agent
  // session init to seed the system prompt and at learning-judge time as
  // the house testing rubric. One row per (capability, repo, file_path);
  // re-fetch is an UPSERT.
  // ────────────────────────────────────────────────────────────────────
  `
    CREATE TABLE IF NOT EXISTS capability_copilot_guidance (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      repository_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'guidance',
      content TEXT NOT NULL,
      sha TEXT NOT NULL,
      commit_sha TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, repository_id, file_path)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_copilot_guidance_fetches (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL,
      message TEXT,
      files_ingested INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (capability_id, fetched_at)
    )
  `,
  // ────────────────────────────────────────────────────────────────────
  // Chat distillation ledger — one row per chat session that has been
  // distilled into the agent's learning profile. Idempotency: re-distilling
  // the same session is an UPSERT that refreshes the correction_preview +
  // distilled_at; callers check existence before re-running.
  // ────────────────────────────────────────────────────────────────────
  `
    CREATE TABLE IF NOT EXISTS capability_chat_distillations (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      distilled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      message_count INTEGER NOT NULL DEFAULT 0,
      correction_preview TEXT NOT NULL DEFAULT '',
      learning_update_id TEXT,
      blocked_by_shape_check BOOLEAN NOT NULL DEFAULT FALSE,
      block_reason TEXT,
      PRIMARY KEY (capability_id, agent_id, session_id)
    )
  `,
  // ────────────────────────────────────────────────────────────────────
  // LLM context log — one row per chat-mode LLM call.
  //
  // Stores the FULL assembled messages[] array sent to the model, plus the
  // budget receipt (which fragments were included vs evicted) and usage
  // numbers. Powers the operator's "View context" drawer so any past chat
  // turn can be replayed verbatim — they can confirm exactly what the LLM
  // saw, paste the prompt into a playground, or diff prompts across turns.
  //
  // Execution-mode (workflow run) calls don't write here — they emit a
  // `LLM_CONTEXT_PREPARED` RunEvent so the prompt sits inline in the run
  // timeline alongside other step events.
  //
  // Retention is best-effort manual today: rows accumulate until pruned
  // (TODO: add a daily cron that keeps last 1000 / 30 days per capability).
  // ────────────────────────────────────────────────────────────────────
  `
    CREATE TABLE IF NOT EXISTS capability_llm_context_log (
      id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      trace_id TEXT,
      agent_id TEXT,
      session_id TEXT,
      session_scope TEXT,
      session_scope_id TEXT,
      work_item_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      messages JSONB NOT NULL,
      budget_receipt JSONB,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      cost_usd NUMERIC(12,6),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  // ────────────────────────────────────────────────────────────────────
  // Code understanding module (Phase A).
  //
  // `capability_code_symbols` is a flat catalog of every named thing in
  // every linked repo of the capability. Refresh is truncate-and-insert
  // inside a transaction: we never partially-update a symbol row, so
  // search queries always see a consistent snapshot.
  //
  // `capability_code_references` is a file-level graph: A imports B.
  // Symbol-level call edges are intentionally out of scope for v1 —
  // they require scope-aware resolution and the file-level edge is
  // enough to drive "what will break if I change this file?"
  //
  // `capability_code_index_runs` is an audit log — one row per refresh
  // attempt so we can surface last-status / last-message in the UI
  // without reconstructing it from the symbols table.
  // ────────────────────────────────────────────────────────────────────
  `
    CREATE TABLE IF NOT EXISTS capability_code_symbols (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      repository_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      symbol_id TEXT,
      container_symbol_id TEXT,
      symbol_name TEXT NOT NULL,
      qualified_symbol_name TEXT,
      kind TEXT NOT NULL,
      language TEXT,
      parent_symbol TEXT,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      slice_start_line INTEGER,
      slice_end_line INTEGER,
      signature TEXT NOT NULL DEFAULT '',
      is_exported BOOLEAN NOT NULL DEFAULT FALSE,
      sha TEXT,
      indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, repository_id, file_path, parent_symbol, symbol_name, start_line)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_capability_code_symbols_search
      ON capability_code_symbols (capability_id, symbol_name)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_capability_code_symbols_file
      ON capability_code_symbols (capability_id, repository_id, file_path)
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_code_references (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      repository_id TEXT NOT NULL,
      from_file TEXT NOT NULL,
      to_module TEXT NOT NULL,
      kind TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, repository_id, from_file, to_module, kind)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_capability_code_references_to
      ON capability_code_references (capability_id, to_module)
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_code_symbol_edges (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      repository_id TEXT NOT NULL,
      from_symbol_id TEXT NOT NULL,
      to_symbol_id TEXT NOT NULL,
      from_file_path TEXT NOT NULL,
      to_file_path TEXT NOT NULL,
      edge_kind TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (
        capability_id,
        repository_id,
        from_symbol_id,
        to_symbol_id,
        edge_kind
      )
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_capability_code_symbol_edges_from
      ON capability_code_symbol_edges (capability_id, from_symbol_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_capability_code_symbol_edges_to
      ON capability_code_symbol_edges (capability_id, to_symbol_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_capability_code_symbol_edges_files
      ON capability_code_symbol_edges (
        capability_id,
        repository_id,
        from_file_path,
        to_file_path
      )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_code_index_runs (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      repositories_indexed INTEGER NOT NULL DEFAULT 0,
      files_indexed INTEGER NOT NULL DEFAULT 0,
      symbols_indexed INTEGER NOT NULL DEFAULT 0,
      references_indexed INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      PRIMARY KEY (capability_id, started_at)
    )
  `,
  // ────────────────────────────────────────────────────────────────────
  // Agent-as-git-author (Phase C).
  //
  // `agent_branch_sessions` tracks one long-lived branch per work item
  // that an agent is actively committing to. A work item can have at
  // most one ACTIVE session per repository, but historical (CLOSED)
  // sessions are retained for provenance.
  //
  // `agent_pull_requests` records every PR the agent opens from a
  // session branch — we keep a history (`opened`, `merged`, `closed`)
  // so the UI can show "PR #12 merged" alongside the session's latest
  // commit, even after GitHub's webhook updates push the state.
  // ────────────────────────────────────────────────────────────────────
  `
    CREATE TABLE IF NOT EXISTS agent_branch_sessions (
      id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      repository_url TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      base_sha TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      head_sha TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      commits_count INTEGER NOT NULL DEFAULT 0,
      last_commit_message TEXT,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_agent_branch_sessions_work_item
      ON agent_branch_sessions (capability_id, work_item_id, status)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_agent_branch_sessions_branch
      ON agent_branch_sessions (capability_id, repository_id, branch_name)
  `,
  `
    CREATE TABLE IF NOT EXISTS agent_pull_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_branch_sessions(id) ON DELETE CASCADE,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_url TEXT NOT NULL,
      html_url TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'OPEN',
      is_draft BOOLEAN NOT NULL DEFAULT TRUE,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      merged_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_agent_pull_requests_session
      ON agent_pull_requests (session_id, state)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_agent_pull_requests_work_item
      ON agent_pull_requests (capability_id, work_item_id, state)
  `,
  // Time-travel debugging for AI decisions (Phase 2 / Lever 7 durable).
  // Every main-model LLM call inside the execution engine persists a
  // "prompt receipt" — enough context to replay the decision against
  // any model. This is the flight recorder. Operators can answer
  // "why did the agent decide X" by viewing the exact fragments the
  // model saw, and "what if we had used a different model" by hitting
  // the replay endpoint.
  `
    CREATE TABLE IF NOT EXISTS run_step_prompt_receipts (
      id TEXT PRIMARY KEY,
      run_step_id TEXT NOT NULL,
      run_id TEXT,
      work_item_id TEXT,
      capability_id TEXT NOT NULL,
      agent_id TEXT,
      agent_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      scope TEXT NOT NULL,
      scope_id TEXT,
      phase TEXT,
      model TEXT,
      provider_key TEXT,
      user_prompt TEXT NOT NULL,
      memory_prompt TEXT,
      developer_prompt TEXT,
      response_content TEXT NOT NULL DEFAULT '',
      response_usage JSONB,
      fragments JSONB NOT NULL DEFAULT '[]'::jsonb,
      evicted JSONB NOT NULL DEFAULT '[]'::jsonb,
      total_estimated_tokens INTEGER NOT NULL DEFAULT 0,
      max_input_tokens INTEGER NOT NULL DEFAULT 0,
      reserved_output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_prompt_receipts_run_step
      ON run_step_prompt_receipts (run_step_id, created_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_prompt_receipts_run
      ON run_step_prompt_receipts (run_id, created_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_prompt_receipts_work_item
      ON run_step_prompt_receipts (capability_id, work_item_id, created_at DESC)
  `,
  // Swarm debate: multi-agent planning sessions anchored to a capability
  // (and optionally a work item). A session has 2-3 participants drawn from
  // the current capability, its parent, children, or explicit shared refs.
  `
    CREATE TABLE IF NOT EXISTS capability_swarm_sessions (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      work_item_id TEXT,
      session_scope TEXT NOT NULL,
      initiator_user_id TEXT,
      status TEXT NOT NULL,
      lead_participant_id TEXT,
      promoted_work_item_id TEXT,
      initiating_prompt TEXT NOT NULL,
      token_budget_used INTEGER NOT NULL DEFAULT 0,
      max_token_budget INTEGER NOT NULL,
      terminal_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_swarm_session_participants (
      capability_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      id TEXT NOT NULL,
      participant_capability_id TEXT NOT NULL,
      participant_agent_id TEXT NOT NULL,
      participant_role TEXT NOT NULL,
      tag_order INTEGER NOT NULL,
      last_vote TEXT,
      vote_rationale TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, session_id, id)
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS capability_swarm_sessions_open_scope_uidx
      ON capability_swarm_sessions (
        capability_id,
        session_scope,
        COALESCE(work_item_id, '__none__')
      )
      WHERE status IN ('PENDING', 'RUNNING', 'AWAITING_REVIEW')
  `,
];

export const migrationStatements = [
  // Column backfills for tables that predate fields the code now reads.
  // All use `ADD COLUMN IF NOT EXISTS` so they're safe on any DB,
  // fresh or aged.
  //
  // desktop_executor_registrations.working_directory: user-level
  // workspace root captured at registration time (plan section A).
  // Without it, desktop:runtime:execution:claim crashes with
  // "column \"working_directory\" ... does not exist".
  `
    ALTER TABLE desktop_executor_registrations
    ADD COLUMN IF NOT EXISTS working_directory TEXT
  `,
  // capability_memory_documents.is_global: per-workspace "global memory"
  // flag consumed by the memory retrieval and learning workers. Without
  // it the learning.worker tick fails and no jobs process.
  `
    ALTER TABLE capability_memory_documents
    ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE
  `,
  // Fallback CREATE TABLE for capability_agent_learning_jobs. The
  // table is already declared in schemaStatements, but on databases
  // that came up when an earlier schemaStatement failed, everything
  // downstream of the failure got silently skipped. Asserting it here
  // guarantees the learning worker has its home even after such a
  // partial init.
  `
    CREATE TABLE IF NOT EXISTS capability_agent_learning_jobs (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      request_reason TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, agent_id)
        REFERENCES capability_agents(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    ALTER TABLE capability_code_symbols
    ADD COLUMN IF NOT EXISTS symbol_id TEXT
  `,
  `
    ALTER TABLE capability_code_symbols
    ADD COLUMN IF NOT EXISTS container_symbol_id TEXT
  `,
  `
    ALTER TABLE capability_code_symbols
    ADD COLUMN IF NOT EXISTS qualified_symbol_name TEXT
  `,
  `
    ALTER TABLE capability_code_symbols
    ADD COLUMN IF NOT EXISTS language TEXT
  `,
  `
    ALTER TABLE capability_code_symbols
    ADD COLUMN IF NOT EXISTS slice_start_line INTEGER
  `,
  `
    ALTER TABLE capability_code_symbols
    ADD COLUMN IF NOT EXISTS slice_end_line INTEGER
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_capability_code_symbols_qualified_search
      ON capability_code_symbols (capability_id, qualified_symbol_name)
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_code_symbol_edges (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      repository_id TEXT NOT NULL,
      from_symbol_id TEXT NOT NULL,
      to_symbol_id TEXT NOT NULL,
      from_file_path TEXT NOT NULL DEFAULT '',
      to_file_path TEXT NOT NULL DEFAULT '',
      edge_kind TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (
        capability_id,
        repository_id,
        from_symbol_id,
        to_symbol_id,
        edge_kind
      )
    )
  `,
  `
    ALTER TABLE capability_code_symbol_edges
    ADD COLUMN IF NOT EXISTS from_file_path TEXT
  `,
  `
    ALTER TABLE capability_code_symbol_edges
    ADD COLUMN IF NOT EXISTS to_file_path TEXT
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_capability_code_symbol_edges_from
      ON capability_code_symbol_edges (capability_id, from_symbol_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_capability_code_symbol_edges_to
      ON capability_code_symbol_edges (capability_id, to_symbol_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_capability_code_symbol_edges_files
      ON capability_code_symbol_edges (
        capability_id,
        repository_id,
        from_file_path,
        to_file_path
      )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_workspace_write_locks (
      capability_id TEXT PRIMARY KEY REFERENCES capabilities(id) ON DELETE CASCADE,
      run_step_id   TEXT NOT NULL,
      run_id        TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      step_name     TEXT NOT NULL DEFAULT '',
      acquired_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
    )
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS git_repositories TEXT[] NOT NULL DEFAULT '{}'
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS local_directories TEXT[] NOT NULL DEFAULT '{}'
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS team_names TEXT[] NOT NULL DEFAULT '{}'
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS stakeholders JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS additional_metadata JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS lifecycle JSONB NOT NULL DEFAULT '{}'::jsonb
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS phase_ownership_rules JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS execution_config JSONB NOT NULL DEFAULT '{}'::jsonb
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS business_outcome TEXT
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS capability_kind TEXT NOT NULL DEFAULT 'DELIVERY'
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS collection_kind TEXT
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS contract_draft JSONB NOT NULL DEFAULT '{}'::jsonb
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS success_metrics TEXT[] NOT NULL DEFAULT '{}'
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS definition_of_done TEXT
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS required_evidence_kinds TEXT[] NOT NULL DEFAULT '{}'
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS operating_policy_summary TEXT
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS database_configs JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS is_system_capability BOOLEAN NOT NULL DEFAULT FALSE
  `,
  `
    ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS system_capability_role TEXT
  `,
  `
    ALTER TABLE workspace_settings
    ADD COLUMN IF NOT EXISTS connector_settings JSONB NOT NULL DEFAULT '{}'::jsonb
  `,
  `
    ALTER TABLE workspace_settings
    ADD COLUMN IF NOT EXISTS foundation_agent_templates JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE workspace_settings
    ADD COLUMN IF NOT EXISTS foundation_workflow_templates JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE workspace_settings
    ADD COLUMN IF NOT EXISTS foundation_eval_suite_templates JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE workspace_settings
    ADD COLUMN IF NOT EXISTS foundation_skill_templates JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE workspace_settings
    ADD COLUMN IF NOT EXISTS foundation_artifact_templates JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE workspace_settings
    ADD COLUMN IF NOT EXISTS foundation_tool_templates JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE workspace_settings
    ADD COLUMN IF NOT EXISTS foundations_initialized_at TIMESTAMPTZ
  `,
  `
    ALTER TABLE workspace_users
    ADD COLUMN IF NOT EXISTS workspace_roles TEXT[] NOT NULL DEFAULT '{}'
  `,
  `
    ALTER TABLE capability_skills
    ADD COLUMN IF NOT EXISTS content_markdown TEXT NOT NULL DEFAULT ''
  `,
  `
    ALTER TABLE capability_skills
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'CUSTOM'
  `,
  `
    ALTER TABLE capability_skills
    ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'CAPABILITY'
  `,
  `
    ALTER TABLE capability_skills
    ADD COLUMN IF NOT EXISTS default_template_keys TEXT[] NOT NULL DEFAULT '{}'
  `,
  `
    ALTER TABLE capability_agents
    ADD COLUMN IF NOT EXISTS is_built_in BOOLEAN NOT NULL DEFAULT FALSE
  `,
  `
    ALTER TABLE capability_agents
    ADD COLUMN IF NOT EXISTS standard_template_key TEXT
  `,
  `
    ALTER TABLE capability_agents
    ADD COLUMN IF NOT EXISTS role_starter_key TEXT
  `,
  `
    ALTER TABLE capability_agents
    ADD COLUMN IF NOT EXISTS contract JSONB NOT NULL DEFAULT '{}'::jsonb
  `,
  `
    ALTER TABLE capability_agents
    ADD COLUMN IF NOT EXISTS preferred_tool_ids TEXT[] NOT NULL DEFAULT '{}'
  `,
  `
    ALTER TABLE capability_agents
    ADD COLUMN IF NOT EXISTS provider_key TEXT
  `,
  `
    ALTER TABLE capability_agents
    ADD COLUMN IF NOT EXISTS embedding_provider_key TEXT
  `,
  `
    ALTER TABLE capability_learning_updates
    ADD COLUMN IF NOT EXISTS trigger_type TEXT
  `,
  `
    ALTER TABLE capability_learning_updates
    ADD COLUMN IF NOT EXISTS related_work_item_id TEXT
  `,
  `
    ALTER TABLE capability_learning_updates
    ADD COLUMN IF NOT EXISTS related_run_id TEXT
  `,
  `
    ALTER TABLE capability_evidence_packets
    ADD COLUMN IF NOT EXISTS touched_paths TEXT[] NOT NULL DEFAULT '{}'
  `,
  // Signed Change Attestation chain — Slice A. Adds per-row chain linkage,
  // Ed25519 signature envelope, and AI-assisted attribution so packets can be
  // verified offline and audit queries can filter by AI involvement. Existing
  // rows default to attestation_version=1, chain_root_bundle_id=bundle_id
  // (backfilled below), is_ai_assisted=TRUE (all current rows are
  // agent-produced), signature/signing_key_id NULL → treated as v1-unsigned.
  `
    ALTER TABLE capability_evidence_packets
    ADD COLUMN IF NOT EXISTS attestation_version SMALLINT NOT NULL DEFAULT 1
  `,
  `
    ALTER TABLE capability_evidence_packets
    ADD COLUMN IF NOT EXISTS prev_bundle_id TEXT
  `,
  `
    ALTER TABLE capability_evidence_packets
    ADD COLUMN IF NOT EXISTS chain_root_bundle_id TEXT
  `,
  `
    ALTER TABLE capability_evidence_packets
    ADD COLUMN IF NOT EXISTS signature TEXT
  `,
  `
    ALTER TABLE capability_evidence_packets
    ADD COLUMN IF NOT EXISTS signing_key_id TEXT
  `,
  `
    ALTER TABLE capability_evidence_packets
    ADD COLUMN IF NOT EXISTS signing_algo TEXT
  `,
  `
    ALTER TABLE capability_evidence_packets
    ADD COLUMN IF NOT EXISTS is_ai_assisted BOOLEAN NOT NULL DEFAULT TRUE
  `,
  `
    ALTER TABLE capability_evidence_packets
    ADD COLUMN IF NOT EXISTS ai_attribution JSONB
  `,
  // Idempotent backfill for rows created before this slice landed — each row
  // becomes its own chain root. Safe to re-run: WHERE chain_root_bundle_id IS
  // NULL ensures no churn on subsequent boots.
  `
    UPDATE capability_evidence_packets
    SET chain_root_bundle_id = bundle_id
    WHERE chain_root_bundle_id IS NULL
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS work_item_id TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS workflow_id TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS workflow_step_id TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS managed_by_workflow BOOLEAN NOT NULL DEFAULT FALSE
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS task_type TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS phase TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS run_id TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS run_step_id TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS tool_invocation_id TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS task_subtype TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS parent_task_id TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS parent_run_id TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS parent_run_step_id TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS delegated_agent_id TEXT
  `,
  `
    ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS handoff_packet_id TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS task_type TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS parent_work_item_id TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS story_points INTEGER
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS t_shirt_size TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS sizing_confidence TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS planning_batch_id TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS planning_proposal_item_id TEXT
  `,
  `
    ALTER TABLE capability_work_item_handoff_packets
    ADD COLUMN IF NOT EXISTS delegation_origin_task_id TEXT
  `,
  `
    ALTER TABLE capability_work_item_handoff_packets
    ADD COLUMN IF NOT EXISTS delegation_origin_agent_id TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS phase_stakeholders JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS phase_owner_team_id TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS claim_owner_user_id TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS watched_by_user_ids TEXT[] NOT NULL DEFAULT '{}'
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS pending_handoff JSONB
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS blocker JSONB
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS active_run_id TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS last_run_id TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS record_version INTEGER NOT NULL DEFAULT 1
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS stage_overrides JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS trace_id TEXT
  `,
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS model TEXT
  `,
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS session_id TEXT
  `,
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS session_scope TEXT
  `,
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS session_scope_id TEXT
  `,
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS work_item_id TEXT
  `,
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS run_id TEXT
  `,
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS workflow_step_id TEXT
  `,
  `
    ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'CAPABILITY'
  `,
  `
    ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1
  `,
  `
    ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS entry_node_id TEXT
  `,
  `
    ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS nodes JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS edges JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS publish_state TEXT NOT NULL DEFAULT 'DRAFT'
  `,
  `
    ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS template_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS template_sections JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS run_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS run_step_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS tool_invocation_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS summary TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS workflow_step_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS work_item_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS artifact_kind TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS phase TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS source_run_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS source_run_step_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS source_wait_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS handoff_from_agent_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS handoff_to_agent_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS content_format TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS mime_type TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS file_name TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS content_text TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS content_json JSONB
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS downloadable BOOLEAN NOT NULL DEFAULT FALSE
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS trace_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS latency_ms INTEGER
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12,6)
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS policy_decision_id TEXT
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS retrieval_references JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS run_id TEXT
  `,
  `
    ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS run_step_id TEXT
  `,
  `
    ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS tool_invocation_id TEXT
  `,
  `
    ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS trace_id TEXT
  `,
  `
    ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS latency_ms INTEGER
  `,
  `
    ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12,6)
  `,
  `
    ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS trace_id TEXT
  `,
  `
    ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS current_node_id TEXT
  `,
  `
    ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS branch_state JSONB NOT NULL DEFAULT '{}'::jsonb
  `,
  `
    ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS queue_reason TEXT
  `,
  `
    ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS assigned_executor_id TEXT
  `,
  `
    ALTER TABLE capability_workflow_run_steps
    ADD COLUMN IF NOT EXISTS span_id TEXT
  `,
  `
    ALTER TABLE capability_workflow_run_steps
    ADD COLUMN IF NOT EXISTS workflow_node_id TEXT
  `,
  `
    UPDATE capability_workflow_run_steps
    SET workflow_node_id = workflow_step_id
    WHERE workflow_node_id IS NULL
  `,
  `
    ALTER TABLE capability_workflow_run_steps
    ADD COLUMN IF NOT EXISTS retrieval_references JSONB NOT NULL DEFAULT '[]'::jsonb
  `,
  `
    ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS trace_id TEXT
  `,
  `
    ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS span_id TEXT
  `,
  `
    ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS sandbox_profile TEXT
  `,
  `
    ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS policy_decision_id TEXT
  `,
  `
    ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS latency_ms INTEGER
  `,
  `
    ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12,6)
  `,
  `
    ALTER TABLE capability_run_events
    ADD COLUMN IF NOT EXISTS trace_id TEXT
  `,
  `
    ALTER TABLE capability_run_events
    ADD COLUMN IF NOT EXISTS span_id TEXT
  `,
  `
    ALTER TABLE capability_run_waits
    ADD COLUMN IF NOT EXISTS trace_id TEXT
  `,
  `
    ALTER TABLE capability_run_waits
    ADD COLUMN IF NOT EXISTS span_id TEXT
  `,
  `
    ALTER TABLE capability_run_waits
    ADD COLUMN IF NOT EXISTS requested_by_actor_user_id TEXT
  `,
  `
    ALTER TABLE capability_run_waits
    ADD COLUMN IF NOT EXISTS requested_by_actor_team_ids TEXT[] NOT NULL DEFAULT '{}'
  `,
  `
    ALTER TABLE capability_run_waits
    ADD COLUMN IF NOT EXISTS resolved_by_actor_user_id TEXT
  `,
  `
    ALTER TABLE capability_run_waits
    ADD COLUMN IF NOT EXISTS resolved_by_actor_team_ids TEXT[] NOT NULL DEFAULT '{}'
  `,
  `
    ALTER TABLE capability_run_waits
    ADD COLUMN IF NOT EXISTS approval_policy_id TEXT
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_workflow_runs_status_idx
    ON capability_workflow_runs (status, updated_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_workflow_runs_work_item_idx
    ON capability_workflow_runs (capability_id, work_item_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_workflow_runs_executor_idx
    ON capability_workflow_runs (assigned_executor_id, status, updated_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_execution_ownership_executor_idx
    ON capability_execution_ownership (executor_id, updated_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS desktop_executor_registrations_heartbeat_idx
    ON desktop_executor_registrations (heartbeat_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS desktop_user_workspace_mappings_lookup_idx
    ON desktop_user_workspace_mappings (executor_id, user_id, capability_id, repository_id, updated_at DESC)
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS desktop_user_workspace_mappings_repo_unique_idx
    ON desktop_user_workspace_mappings (executor_id, user_id, capability_id, repository_id)
    WHERE repository_id IS NOT NULL
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS desktop_user_workspace_mappings_capability_unique_idx
    ON desktop_user_workspace_mappings (executor_id, user_id, capability_id)
    WHERE repository_id IS NULL
  `,
  `
    CREATE INDEX IF NOT EXISTS desktop_work_item_checkout_sessions_recent_idx
    ON desktop_work_item_checkout_sessions (
      executor_id,
      capability_id,
      work_item_id,
      user_id,
      updated_at DESC
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_repositories_primary_idx
    ON capability_repositories (capability_id, is_primary, created_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_dependencies_target_idx
    ON capability_dependencies (target_capability_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_shared_references_member_idx
    ON capability_shared_references (member_capability_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_parent_idx
    ON capabilities (parent_capability_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_kind_idx
    ON capabilities (capability_kind, collection_kind)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_published_snapshots_version_idx
    ON capability_published_snapshots (capability_id, publish_version DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_work_item_branches_work_item_idx
    ON capability_work_item_branches (capability_id, work_item_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_work_item_code_claims_work_item_idx
    ON capability_work_item_code_claims (capability_id, work_item_id, status, updated_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_work_item_handoff_packets_work_item_idx
    ON capability_work_item_handoff_packets (capability_id, work_item_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_run_events_run_idx
    ON capability_run_events (capability_id, run_id, created_at ASC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_run_waits_run_idx
    ON capability_run_waits (capability_id, run_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_artifacts_work_item_idx
    ON capability_artifacts (capability_id, work_item_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_artifacts_run_idx
    ON capability_artifacts (capability_id, source_run_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_trace_spans_trace_idx
    ON capability_trace_spans (capability_id, trace_id, started_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_metric_samples_scope_idx
    ON capability_metric_samples (capability_id, scope_type, scope_id, recorded_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_policy_decisions_run_idx
    ON capability_policy_decisions (capability_id, run_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_memory_documents_source_idx
    ON capability_memory_documents (capability_id, source_type, updated_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_memory_chunks_document_idx
    ON capability_memory_chunks (capability_id, document_id, chunk_index ASC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_memory_embeddings_chunk_idx
    ON capability_memory_embeddings (capability_id, chunk_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_eval_runs_suite_idx
    ON capability_eval_runs (capability_id, suite_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_agent_learning_jobs_status_idx
    ON capability_agent_learning_jobs (status, requested_at ASC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_agent_learning_jobs_agent_idx
    ON capability_agent_learning_jobs (capability_id, agent_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_agent_sessions_agent_idx
    ON capability_agent_sessions (capability_id, agent_id, last_used_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_agent_session_memories_scope_idx
    ON capability_agent_session_memories (
      capability_id,
      agent_id,
      scope,
      scope_id,
      last_message_at DESC,
      updated_at DESC
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_evidence_packets_created_idx
    ON capability_evidence_packets (capability_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_evidence_packets_touched_paths_idx
    ON capability_evidence_packets USING GIN (touched_paths)
  `,
  // Slice A — attestation chain indexes. chain_root_idx speeds up "show me the
  // whole chain"; workitem_created_idx is the lookup path for the prev pointer
  // when sealing a new packet; ai_paths_idx is tuned for prove-the-negative
  // queries (restricts the GIN to rows where is_ai_assisted=TRUE so irrelevant
  // entries never enter the index).
  `
    CREATE INDEX IF NOT EXISTS capability_evidence_packets_chain_root_idx
    ON capability_evidence_packets (chain_root_bundle_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_evidence_packets_workitem_created_idx
    ON capability_evidence_packets (work_item_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_evidence_packets_ai_paths_idx
    ON capability_evidence_packets USING GIN (touched_paths)
    WHERE is_ai_assisted = TRUE
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_incidents_capability_time_idx
    ON capability_incidents (capability_id, detected_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_incidents_source_external_idx
    ON capability_incidents (source, external_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_incident_links_packet_idx
    ON capability_incident_packet_links (packet_bundle_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_incident_links_correlation_idx
    ON capability_incident_packet_links (correlation)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_incident_jobs_status_idx
    ON capability_incident_jobs (status, available_at ASC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_incident_jobs_incident_idx
    ON capability_incident_jobs (incident_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS incident_export_deliveries_target_idx
    ON incident_export_deliveries (target, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS incident_export_deliveries_incident_idx
    ON incident_export_deliveries (incident_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS incident_export_deliveries_capability_idx
    ON incident_export_deliveries (capability_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_incident_guardrail_promotions_capability_idx
    ON capability_incident_guardrail_promotions (capability_id, created_at DESC)
  `,
  // Slice A — append-only version history for agent learning profiles.
  // Writes always go through this table first then flip the current_version_id
  // pointer on capability_agent_learning_profiles in the same transaction,
  // so a corrupt distillation can never erase prior state.
  `
    CREATE TABLE IF NOT EXISTS capability_agent_learning_profile_versions (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      version_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      version_no INTEGER NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
      context_block TEXT NOT NULL DEFAULT '',
      source_document_ids TEXT[] NOT NULL DEFAULT '{}',
      source_artifact_ids TEXT[] NOT NULL DEFAULT '{}',
      source_count INTEGER NOT NULL DEFAULT 0,
      derivation_mode TEXT,
      derived_from_agent_id TEXT,
      source_version_id TEXT,
      context_block_tokens INTEGER,
      judge_score NUMERIC,
      judge_report JSONB,
      shape_report JSONB,
      created_by_update_id TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, version_id),
      UNIQUE (capability_id, agent_id, version_no),
      FOREIGN KEY (capability_id, agent_id)
        REFERENCES capability_agents(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS current_version_id TEXT
  `,
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS previous_version_id TEXT
  `,
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS derivation_mode TEXT
  `,
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS derived_from_agent_id TEXT
  `,
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS source_version_id TEXT
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_agent_learning_profile_versions_created_idx
    ON capability_agent_learning_profile_versions (capability_id, agent_id, created_at DESC)
  `,
  // Slice B — evaluation fixtures for the LLM-judge quality gate. Rows are
  // bootstrapped from recent successful sessions and refreshed weekly.
  `
    CREATE TABLE IF NOT EXISTS capability_agent_eval_fixtures (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      fixture_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      source_session_id TEXT,
      prompt TEXT NOT NULL,
      reference_response TEXT,
      expected_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      PRIMARY KEY (capability_id, fixture_id),
      FOREIGN KEY (capability_id, agent_id)
        REFERENCES capability_agents(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_agent_eval_fixtures_agent_idx
    ON capability_agent_eval_fixtures (capability_id, agent_id)
  `,
  // Slice C — canary + drift-detection columns on the live profile row.
  // Counters reset on every version flip; `drift_flagged_at` + `drift_reason`
  // remain until an operator either reverts or the next flip clears them.
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS canary_started_at TIMESTAMPTZ
  `,
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS canary_request_count INTEGER NOT NULL DEFAULT 0
  `,
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS canary_negative_count INTEGER NOT NULL DEFAULT 0
  `,
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS drift_flagged_at TIMESTAMPTZ
  `,
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS drift_reason TEXT
  `,
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS drift_regression_streak INTEGER NOT NULL DEFAULT 0
  `,
  `
    ALTER TABLE capability_agent_learning_profiles
    ADD COLUMN IF NOT EXISTS drift_last_checked_at TIMESTAMPTZ
  `,
  // Slice C — when a version is replaced, freeze its final canary counters
  // onto the version row so the drift detector has a stable baseline to
  // compare the new live canary against.
  `
    ALTER TABLE capability_agent_learning_profile_versions
    ADD COLUMN IF NOT EXISTS frozen_request_count INTEGER
  `,
  `
    ALTER TABLE capability_agent_learning_profile_versions
    ADD COLUMN IF NOT EXISTS derivation_mode TEXT
  `,
  `
    ALTER TABLE capability_agent_learning_profile_versions
    ADD COLUMN IF NOT EXISTS derived_from_agent_id TEXT
  `,
  `
    ALTER TABLE capability_agent_learning_profile_versions
    ADD COLUMN IF NOT EXISTS source_version_id TEXT
  `,
  `
    ALTER TABLE capability_agent_learning_profile_versions
    ADD COLUMN IF NOT EXISTS frozen_negative_count INTEGER
  `,
  `
    ALTER TABLE capability_agent_learning_profile_versions
    ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ
  `,
  // Slice 2 — governance controls catalog indexes. The framework filter is
  // the hot path for the UI ("show me all NIST CSF controls"); the bindings
  // control_idx is the hot path for "what policies satisfy this control?".
  `
    CREATE INDEX IF NOT EXISTS governance_controls_framework_idx
    ON governance_controls (framework, control_code)
  `,
  `
    CREATE INDEX IF NOT EXISTS governance_controls_status_idx
    ON governance_controls (status)
  `,
  `
    CREATE INDEX IF NOT EXISTS governance_control_bindings_control_idx
    ON governance_control_bindings (control_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS governance_control_bindings_scope_idx
    ON governance_control_bindings (capability_scope)
  `,
  // Slice 3 — exception lifecycle indexes + policy-decision stamping columns.
  // `gex_active_idx` is the hot path for evaluateToolPolicy's active-exception
  // lookup; `gex_expiry_idx` is the hot path for the scheduler's expire sweep.
  `
    CREATE INDEX IF NOT EXISTS gex_active_idx
    ON governance_exceptions (capability_id, control_id, status)
    WHERE status IN ('APPROVED', 'REQUESTED')
  `,
  `
    CREATE INDEX IF NOT EXISTS gex_expiry_idx
    ON governance_exceptions (expires_at)
    WHERE status = 'APPROVED'
  `,
  `
    CREATE INDEX IF NOT EXISTS gex_capability_idx
    ON governance_exceptions (capability_id, status)
  `,
  `
    CREATE INDEX IF NOT EXISTS gex_events_exception_idx
    ON governance_exception_events (exception_id, at DESC)
  `,
  `
    ALTER TABLE capability_policy_decisions
    ADD COLUMN IF NOT EXISTS exception_id TEXT
  `,
  `
    ALTER TABLE capability_policy_decisions
    ADD COLUMN IF NOT EXISTS exception_expires_at TIMESTAMPTZ
  `,
  // ──────────────────────────────────────────────────────────────────
  // Slice 4 — prove-the-negative provenance. touched_paths is a
  // normalized array of filesystem paths a tool invocation touched
  // (extracted per-tool at write time); actor_kind distinguishes AI
  // vs HUMAN invocations. Both are additive and cheap to leave in
  // place on rollback. The GIN index powers the @> containment probe
  // in /provenance/prove-no-touch.
  // ──────────────────────────────────────────────────────────────────
  `
    ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS touched_paths TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
  `,
  `
    ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS actor_kind TEXT NOT NULL DEFAULT 'AI'
  `,
  `
    CREATE INDEX IF NOT EXISTS cti_touched_paths_gin
    ON capability_tool_invocations USING GIN (touched_paths)
  `,
  `
    CREATE INDEX IF NOT EXISTS cti_actor_started_idx
    ON capability_tool_invocations (actor_kind, started_at DESC)
  `,
  // Durability ring: every prove-the-negative answer references the
  // exact coverage window so "no match" never silently masks a gap
  // in logging. Populated by the backfill script + the write-side
  // hook when logging resumes after an outage.
  `
    CREATE TABLE IF NOT EXISTS governance_provenance_coverage (
      coverage_id   TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      window_start  TIMESTAMPTZ NOT NULL,
      window_end    TIMESTAMPTZ NOT NULL,
      source        TEXT NOT NULL,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS gpc_capability_window_idx
    ON governance_provenance_coverage (capability_id, window_start, window_end)
  `,
  // ────────────────────────────────────────────────────────────────────
  // Agent-as-git-author — race-safety hardening.
  //
  // A partial unique index guarantees **at most one open session** per
  // (capability, work item, repository). Historical CLOSED rows are
  // retained outside the predicate, so provenance is untouched. Pair
  // this with `INSERT ... ON CONFLICT DO NOTHING RETURNING *` in
  // `createOrReuseAgentBranchSessionTx` to make the insert-after-select
  // path survive a concurrent producer.
  //
  // Safe to add to existing DBs: the prior SELECT-first code path made
  // duplicate rows extremely unlikely, and `CREATE UNIQUE INDEX
  // IF NOT EXISTS` errors loudly (not silently) if the invariant is
  // already broken — which is the behavior we want.
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_branch_sessions_open_unique
      ON agent_branch_sessions (capability_id, work_item_id, repository_id)
      WHERE status IN ('ACTIVE', 'REVIEWING', 'FAILED')
  `,
  // ────────────────────────────────────────────────────────────────────
  // Agent-as-git-author — per-commit audit trail.
  //
  // `agent_branch_commits` answers "which artifact produced which
  // commit SHA?". The session row tracks aggregates (`commits_count`,
  // `last_commit_message`); this table keeps the forensic detail.
  // `artifact_id` is nullable because operator-initiated commits via
  // `commitRawPatchToSession` don't always originate from an artifact.
  // ────────────────────────────────────────────────────────────────────
  `
    CREATE TABLE IF NOT EXISTS agent_branch_commits (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_branch_sessions(id) ON DELETE CASCADE,
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      artifact_id TEXT,
      artifact_kind TEXT,
      message TEXT NOT NULL DEFAULT '',
      files_committed_count INTEGER NOT NULL DEFAULT 0,
      files_skipped_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_agent_branch_commits_session
      ON agent_branch_commits (session_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_agent_branch_commits_artifact
      ON agent_branch_commits (artifact_id)
      WHERE artifact_id IS NOT NULL
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_agent_branch_commits_work_item
      ON agent_branch_commits (capability_id, work_item_id, created_at DESC)
  `,
  // Phase-segment workflow model (plan: Phase-Segment Workflow Model).
  // A "segment" is an operator-scoped advance of a work item across a
  // phase range. One segment → N runs (retries share the same intention).
  // Legacy runs with segment_id IS NULL behave exactly as before —
  // they traverse to DONE with no stop boundary.
  `
    CREATE TABLE IF NOT EXISTS capability_work_item_segments (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      segment_index INTEGER NOT NULL,
      start_phase TEXT NOT NULL,
      stop_after_phase TEXT,
      intention TEXT NOT NULL,
      status TEXT NOT NULL,
      terminal_outcome TEXT,
      priority_snapshot TEXT NOT NULL,
      current_run_id TEXT,
      first_run_id TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      actor_user_id TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      UNIQUE (capability_id, work_item_id, segment_index)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_work_item_segments_queue_idx
      ON capability_work_item_segments (status, priority_snapshot, updated_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_work_item_segments_wi_idx
      ON capability_work_item_segments (capability_id, work_item_id, segment_index DESC)
  `,
  // Runs need to know which segment they belong to; the priority snapshot
  // is duplicated here so claim SQL can ORDER BY without a join.
  `
    ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS segment_id TEXT
  `,
  `
    ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS priority_snapshot TEXT
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_workflow_runs_claim_order_idx
      ON capability_workflow_runs (status, priority_snapshot, updated_at)
  `,
  // Work items carry a long-lived brief (cross-segment context) and an
  // optional preset used by the one-click "Start next" flow.
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS brief TEXT
  `,
  `
    ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS next_segment_preset JSONB
  `,
  // Swarm debate additive columns. Legacy rows keep NULL on every column
  // and behave exactly as today; no backfill required.
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS swarm_session_id TEXT
  `,
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS swarm_turn_type TEXT
  `,
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS source_capability_id TEXT
  `,
  // Hidden tool-history rows persisted by the agentRuntime tool-loop so
  // follow-up user turns inherit prior tool evidence.  UI surfaces filter
  // these out by default; the LLM still sees them in the forwarded history.
  `
    ALTER TABLE capability_messages
    ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE
  `,
  `
    ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS swarm_session_id TEXT
  `,
  `
    ALTER TABLE capability_swarm_sessions
    ADD COLUMN IF NOT EXISTS promoted_work_item_id TEXT
  `,
  // Partial index over open swarm sessions so the concurrency check
  // (one active session per work item) is a cheap single-row lookup.
  `
    DROP INDEX IF EXISTS capability_swarm_sessions_open_idx
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS capability_swarm_sessions_open_scope_uidx
      ON capability_swarm_sessions (
        capability_id,
        session_scope,
        COALESCE(work_item_id, '__none__')
      )
      WHERE status IN ('RUNNING', 'AWAITING_REVIEW', 'PENDING')
  `,
  // ── Step Kit: configurable palette templates ──────────────────────────────
  `
    CREATE TABLE IF NOT EXISTS workspace_step_templates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      capability_id TEXT,
      node_type TEXT NOT NULL CHECK (node_type IN ('HUMAN_TASK','AGENT_TASK')),
      label TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      default_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS workspace_step_templates_workspace_idx
      ON workspace_step_templates (workspace_id, capability_id)
  `,
  // ── Workflow versioning + immutability ────────────────────────────────────
  `
    ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1
  `,
  `
    ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ
  `,
  `
    ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS locked_by TEXT
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_workflow_versions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
      edges JSONB NOT NULL DEFAULT '[]'::jsonb,
      publish_state TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      change_summary TEXT,
      UNIQUE (workflow_id, version)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_workflow_versions_wf_idx
      ON capability_workflow_versions (workflow_id, version DESC)
  `,
  // ── Human task email assignment ───────────────────────────────────────────
  `
    ALTER TABLE capability_approval_assignments
    ADD COLUMN IF NOT EXISTS assignee_email TEXT
  `,
  // ── Sub-workflow composition ──────────────────────────────────────────────
  `
    ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS parent_run_id TEXT
  `,
  `
    ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS parent_run_node_id TEXT
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_workflow_runs_parent_idx
      ON capability_workflow_runs (parent_run_id)
      WHERE parent_run_id IS NOT NULL
  `,
  // ── In-app notifications for alert dispatcher ─────────────────────────────
  `
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      run_id TEXT,
      capability_id TEXT,
      node_id TEXT,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS notifications_user_idx
      ON notifications (user_id, acknowledged, created_at DESC)
  `,
  // ── Policy templates library ──────────────────────────────────────────────
  `
    CREATE TABLE IF NOT EXISTS workspace_policy_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      policy_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      category TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  // ── Desktop preferences ────────────────────────────────────────────────────
  // Non-secret, per-machine settings keyed by a hash of the machine hostname.
  // Security tokens (GITHUB_MODELS_TOKEN, LOCAL_OPENAI_API_KEY, etc.) are
  // intentionally excluded — they remain in .env.local only.
  `
    CREATE TABLE IF NOT EXISTS desktop_preferences (
      id TEXT PRIMARY KEY,
      hostname TEXT NOT NULL,
      working_directory TEXT,
      copilot_cli_url TEXT,
      allow_http_fallback BOOLEAN,
      embedding_base_url TEXT,
      embedding_model TEXT,
      runtime_port INTEGER,
      executor_id TEXT,
      extra JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS desktop_preferences_hostname_idx
      ON desktop_preferences (hostname)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_llm_context_log_capability_created_idx
      ON capability_llm_context_log (capability_id, created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_llm_context_log_trace_idx
      ON capability_llm_context_log (trace_id)
      WHERE trace_id IS NOT NULL
  `,
  // ───────────────────────────────────────────────────────────────────────
  // Business Workflow Designer
  //
  // A separate workflow surface from the existing agent-driven
  // `capability_workflows`. Models human-driven business processes
  // (approvals, expense reviews, contract sign-offs, onboarding) with
  // optional hybrid steps that delegate to capability agents.
  //
  // Tables prefixed `capability_business_*` so they cannot collide with
  // the existing agent-workflow namespace. The agent designer continues
  // to live untouched in `capability_workflows`.
  // ───────────────────────────────────────────────────────────────────────
  `
    CREATE TABLE IF NOT EXISTS capability_business_workflow_templates (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      current_version INTEGER NOT NULL DEFAULT 0,
      draft_nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
      draft_edges JSONB NOT NULL DEFAULT '[]'::jsonb,
      draft_phases JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      archived_at TIMESTAMPTZ,
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_business_workflow_template_versions (
      capability_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      nodes JSONB NOT NULL,
      edges JSONB NOT NULL,
      phases JSONB NOT NULL,
      published_by TEXT NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, template_id, version),
      FOREIGN KEY (capability_id, template_id)
        REFERENCES capability_business_workflow_templates(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_business_workflow_custom_node_types (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      base_type TEXT NOT NULL,
      label TEXT NOT NULL,
      color TEXT,
      icon TEXT,
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id),
      UNIQUE (capability_id, name)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_business_workflow_instances (
      capability_id TEXT NOT NULL,
      id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      template_version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      active_node_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_by TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (capability_id, id),
      FOREIGN KEY (capability_id, template_id)
        REFERENCES capability_business_workflow_templates(capability_id, id)
        ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_business_tasks (
      capability_id TEXT NOT NULL,
      id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      assignment_mode TEXT NOT NULL,
      assigned_user_id TEXT,
      assigned_team_id TEXT,
      assigned_role TEXT,
      assigned_skill TEXT,
      claimed_by TEXT,
      claimed_at TIMESTAMPTZ,
      due_at TIMESTAMPTZ,
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      form_schema JSONB,
      form_data JSONB,
      output JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_business_approvals (
      capability_id TEXT NOT NULL,
      id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      assigned_user_id TEXT,
      assigned_team_id TEXT,
      assigned_role TEXT,
      due_at TIMESTAMPTZ,
      decision TEXT,
      decided_by TEXT,
      decided_at TIMESTAMPTZ,
      conditions TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_business_workflow_events (
      id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      node_id TEXT,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      actor_id TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS capability_business_workflow_mutations (
      id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      mutation_type TEXT NOT NULL,
      before_state JSONB,
      after_state JSONB,
      performed_by TEXT NOT NULL,
      performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  // Indexes for the runtime tables (inbox queries hit these heavily).
  `
    CREATE INDEX IF NOT EXISTS capability_business_tasks_status_idx
      ON capability_business_tasks (capability_id, status)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_business_tasks_instance_idx
      ON capability_business_tasks (capability_id, instance_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_business_approvals_instance_idx
      ON capability_business_approvals (capability_id, instance_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_business_workflow_events_instance_idx
      ON capability_business_workflow_events (capability_id, instance_id, occurred_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS capability_business_workflow_template_versions_template_idx
      ON capability_business_workflow_template_versions (capability_id, template_id, version DESC)
  `,
];

const detectOptionalPlatformExtensions = async (client: PoolClient) => {
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  } catch (error) {
    console.warn('pgvector is not available in this Postgres instance; using JSON embeddings fallback.');
  }

  const extensionResult = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS(
        SELECT 1
        FROM pg_extension
        WHERE extname = 'vector'
      ) AS exists
    `,
  );
  platformFeatureState.pgvectorAvailable = Boolean(extensionResult.rows[0]?.exists);
};

const ensureOptionalVectorSchema = async (client: PoolClient) => {
  if (platformFeatureState.pgvectorAvailable) {
    await client.query(
      `
        ALTER TABLE capability_memory_embeddings
        ADD COLUMN IF NOT EXISTS embedding_vector vector(${MEMORY_EMBEDDING_DIMENSIONS})
      `,
    );
    await client.query(
      `
        CREATE INDEX IF NOT EXISTS capability_memory_embeddings_vector_idx
        ON capability_memory_embeddings
        USING hnsw (embedding_vector vector_cosine_ops)
      `,
    );
  }
};

const getDatabaseErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to reach the configured Postgres server.';

const withDisposablePool = async <T>(
  config: RuntimeDatabaseConfig,
  database: string,
  fn: (pool: Pool) => Promise<T>,
) => {
  const pool = new Pool({
    ...getConnectionConfig(config),
    database,
  });

  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => undefined);
  }
};

const ensureDatabaseExists = async (config: RuntimeDatabaseConfig = runtimeDatabaseConfig) => {
  const safeDatabaseName = getSafeDatabaseName(config.databaseName);

  try {
    const probePool = new Pool({
      ...getConnectionConfig(config),
      database: safeDatabaseName,
    });
    await probePool.query('SELECT 1');
    await probePool.end();
    return;
  } catch (error) {
    const dbError = error as { code?: string };
    if (dbError.code !== '3D000') {
      throw error;
    }
  }

  const adminPool = new Pool({
    ...getConnectionConfig(config),
    database: getSafeAdminDatabaseName(config.adminDatabaseName),
  });

  try {
    const { rowCount } = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [safeDatabaseName],
    );

    if (!rowCount) {
      await adminPool.query(`CREATE DATABASE ${safeDatabaseName}`);
    }
  } finally {
    await adminPool.end();
  }
};

export const getDatabaseRuntimeInfo = () => ({
  host: runtimeDatabaseConfig.host,
  port: runtimeDatabaseConfig.port,
  databaseName: runtimeDatabaseConfig.databaseName,
  user: runtimeDatabaseConfig.user,
  adminDatabaseName: runtimeDatabaseConfig.adminDatabaseName,
  passwordConfigured: Boolean(runtimeDatabaseConfig.password),
  pgvectorAvailable: platformFeatureState.pgvectorAvailable,
  ...getMemoryRetrievalDiagnostics(),
  lastConnectionError: lastDatabaseConnectionError || undefined,
});

export const resetDatabasePool = async () => {
  const activePoolPromise = poolPromise;
  poolPromise = null;

  if (!activePoolPromise) {
    return;
  }

  const pool = await activePoolPromise.catch(() => null);
  await pool?.end().catch(() => undefined);
};

export const setDatabaseRuntimeConfig = async (
  updates: Partial<WorkspaceDatabaseBootstrapConfig>,
) => {
  runtimeDatabaseConfig = createRuntimeDatabaseConfig({
    ...runtimeDatabaseConfig,
    ...updates,
  });
  process.env.PGHOST = runtimeDatabaseConfig.host;
  process.env.PGPORT = String(runtimeDatabaseConfig.port);
  process.env.PGDATABASE = runtimeDatabaseConfig.databaseName;
  process.env.PGUSER = runtimeDatabaseConfig.user;
  process.env.PGADMIN_DATABASE = runtimeDatabaseConfig.adminDatabaseName;
  if (updates.password !== undefined) {
    if (runtimeDatabaseConfig.password) {
      process.env.PGPASSWORD = runtimeDatabaseConfig.password;
    } else {
      delete process.env.PGPASSWORD;
    }
  }
  lastDatabaseConnectionError = null;
  await resetDatabasePool();
  return getDatabaseRuntimeInfo();
};

export const inspectDatabaseBootstrapStatus = async (): Promise<WorkspaceDatabaseBootstrapStatus> => {
  const config = runtimeDatabaseConfig;
  let adminReachable = false;
  let databaseExists = false;
  let databaseReachable = false;
  let schemaInitialized = false;
  let foundationsInitialized = false;
  let lastError = lastDatabaseConnectionError || undefined;

  try {
    await withDisposablePool(
      config,
      getSafeAdminDatabaseName(config.adminDatabaseName),
      async pool => {
        await pool.query('SELECT 1');
        adminReachable = true;
        const databaseResult = await pool.query<{ exists: boolean }>(
          'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
          [getSafeDatabaseName(config.databaseName)],
        );
        databaseExists = Boolean(databaseResult.rows[0]?.exists);
      },
    );
  } catch (error) {
    lastError = getDatabaseErrorMessage(error);
  }

  try {
    await withDisposablePool(config, getSafeDatabaseName(config.databaseName), async pool => {
      await pool.query('SELECT 1');
      databaseReachable = true;
      databaseExists = true;

      const schemaResult = await pool.query<{
        capabilities: string | null;
        workspace_settings: string | null;
      }>(
        `
          SELECT
            to_regclass('public.capabilities') AS capabilities,
            to_regclass('public.workspace_settings') AS workspace_settings
        `,
      );

      schemaInitialized = Boolean(
        schemaResult.rows[0]?.capabilities && schemaResult.rows[0]?.workspace_settings,
      );

      if (schemaInitialized) {
        const foundationsResult = await pool.query<{ initialized: string | null }>(
          `
            SELECT foundations_initialized_at::text AS initialized
            FROM workspace_settings
            WHERE id = $1
          `,
          ['DEFAULT'],
        );
        foundationsInitialized = Boolean(foundationsResult.rows[0]?.initialized);
      }
    });
  } catch (error) {
    lastError = lastError || getDatabaseErrorMessage(error);
  }

  return {
    runtime: getDatabaseRuntimeInfo(),
    adminReachable,
    databaseExists,
    databaseReachable,
    schemaInitialized,
    foundationsInitialized,
    ready: databaseReachable && schemaInitialized && foundationsInitialized,
    lastError,
  };
};

export const getPool = async () => {
  if (!poolPromise) {
    poolPromise = (async () => {
      await ensureDatabaseExists(runtimeDatabaseConfig);
      const pool = new Pool({
        ...getConnectionConfig(runtimeDatabaseConfig),
        database: getSafeDatabaseName(runtimeDatabaseConfig.databaseName),
      });
      await pool.query('SELECT 1');
      lastDatabaseConnectionError = null;
      return pool;
    })().catch(error => {
      lastDatabaseConnectionError = getDatabaseErrorMessage(error);
      poolPromise = null;
      throw error;
    });
  }

  return poolPromise;
};

export const query = async <T = unknown>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> => {
  const pool = await getPool();
  return pool.query<T>(text, params);
};

export const withClient = async <T>(fn: (client: PoolClient) => Promise<T>) => {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    return await fn(client);
  } finally {
    client.release();
  }
};

export const transaction = async <T>(fn: (client: PoolClient) => Promise<T>) =>
  withClient(async client => {
    await client.query('BEGIN');

    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

// Runs a single DDL statement, logging a compact preview + full error
// when it fails. Without this, a broken statement deep in the schema
// list shows up as "column X does not exist" at runtime and you have
// to bisect by hand to find which CREATE/ALTER actually failed.
const runDdl = async (
  client: PoolClient,
  phase: 'schema' | 'migration',
  index: number,
  statement: string,
) => {
  try {
    await client.query(statement);
  } catch (error) {
    // First meaningful line is almost always enough to identify the
    // statement — either the CREATE TABLE header or the ALTER TABLE line.
    const preview =
      statement
        .split('\n')
        .map(line => line.trim())
        .find(line => line && !line.startsWith('--')) || '(empty)';
    console.error(
      `[db.init] ${phase} statement #${index} failed: ${preview}\n` +
        (error instanceof Error ? error.message : String(error)),
    );
    throw error;
  }
};

export const initializeDatabase = async () => {
  try {
    await withClient(async client => {
      await detectOptionalPlatformExtensions(client);
      for (let i = 0; i < schemaStatements.length; i += 1) {
        await runDdl(client, 'schema', i, schemaStatements[i]);
      }
      for (let i = 0; i < migrationStatements.length; i += 1) {
        await runDdl(client, 'migration', i, migrationStatements[i]);
      }
      await ensureOptionalVectorSchema(client);
      // Slice 2 — governance controls catalog is owned by the seed module.
      // Upsert happens inside the same connection so a bootstrap failure
      // here rolls back cleanly (the seed is small and idempotent).
      // Dynamic import keeps the governance module off the cold path for
      // test-only bootstraps that stub the DB layer.
      const { ensureControlsSeeded } = await import('./governance/controls');
      await ensureControlsSeeded(client);
    });
    lastDatabaseConnectionError = null;
  } catch (error) {
    lastDatabaseConnectionError = getDatabaseErrorMessage(error);
    throw error;
  }
};

export const getPlatformFeatureState = () => ({
  pgvectorAvailable: platformFeatureState.pgvectorAvailable,
  memoryEmbeddingDimensions: MEMORY_EMBEDDING_DIMENSIONS,
});
