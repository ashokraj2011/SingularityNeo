-- Singularity Neo PostgreSQL schema export
-- Source: server/db.ts
-- Purpose: recreate the persistent backend objects in another implementation.
-- Notes:
--   1. Run this against an existing PostgreSQL database. Database creation is not included.
--   2. JSONB, array, and TIMESTAMPTZ types are used throughout.
--   3. pgvector acceleration is optional; the DO block at the end enables it only when available.

BEGIN;

-- Base schema

CREATE TABLE IF NOT EXISTS capabilities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      domain TEXT,
      parent_capability_id TEXT REFERENCES capabilities(id) ON DELETE SET NULL,
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
      git_repositories TEXT[] NOT NULL DEFAULT '{}',
      local_directories TEXT[] NOT NULL DEFAULT '{}',
      team_names TEXT[] NOT NULL DEFAULT '{}',
      stakeholders JSONB NOT NULL DEFAULT '[]'::jsonb,
      additional_metadata JSONB NOT NULL DEFAULT '[]'::jsonb,
      lifecycle JSONB NOT NULL DEFAULT '{}'::jsonb,
      execution_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL,
      special_agent_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS capability_workspaces (
      capability_id TEXT PRIMARY KEY REFERENCES capabilities(id) ON DELETE CASCADE,
      active_chat_agent_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS capability_skills (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      version TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    );

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
      learning_notes TEXT[] NOT NULL DEFAULT '{}',
      skill_ids TEXT[] NOT NULL DEFAULT '{}',
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      token_limit INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    );

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
      refreshed_at TIMESTAMPTZ,
      last_requested_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, agent_id),
      FOREIGN KEY (capability_id, agent_id)
        REFERENCES capability_agents(capability_id, id)
        ON DELETE CASCADE
    );

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
    );

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
    );

CREATE TABLE IF NOT EXISTS capability_messages (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      agent_id TEXT,
      agent_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    );

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
    );

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
    );

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
      linked_artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
      produced_outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    );

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
    );

CREATE TABLE IF NOT EXISTS capability_learning_updates (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      source_log_ids TEXT[] NOT NULL DEFAULT '{}',
      insight TEXT NOT NULL,
      skill_update TEXT,
      timestamp TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    );

CREATE TABLE IF NOT EXISTS capability_work_items (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      phase TEXT NOT NULL,
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
      history JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    );

CREATE TABLE IF NOT EXISTS capability_workflow_runs (
      capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL,
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
    );

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
    );

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
    );

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
    );

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
      resolution TEXT,
      resolved_by TEXT,
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
    );

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
    );

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
    );

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
    );

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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (capability_id, id)
    );

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
    );

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
    );

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
    );

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
    );

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
    );

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
    );

-- Compatibility migrations and indexes

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS git_repositories TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS local_directories TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS team_names TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS stakeholders JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS additional_metadata JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS lifecycle JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS execution_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS business_outcome TEXT;

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS success_metrics TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS definition_of_done TEXT;

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS required_evidence_kinds TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE capabilities
    ADD COLUMN IF NOT EXISTS operating_policy_summary TEXT;

ALTER TABLE capability_agents
    ADD COLUMN IF NOT EXISTS is_built_in BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS work_item_id TEXT;

ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS workflow_id TEXT;

ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS workflow_step_id TEXT;

ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS managed_by_workflow BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS task_type TEXT;

ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS phase TEXT;

ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS run_id TEXT;

ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS run_step_id TEXT;

ALTER TABLE capability_tasks
    ADD COLUMN IF NOT EXISTS tool_invocation_id TEXT;

ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS blocker JSONB;

ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS active_run_id TEXT;

ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS last_run_id TEXT;

ALTER TABLE capability_work_items
    ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'CAPABILITY';

ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS entry_node_id TEXT;

ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS nodes JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS edges JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE capability_workflows
    ADD COLUMN IF NOT EXISTS publish_state TEXT NOT NULL DEFAULT 'DRAFT';

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS run_id TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS run_step_id TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS tool_invocation_id TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS summary TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS work_item_id TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS artifact_kind TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS phase TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS source_run_id TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS source_run_step_id TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS source_wait_id TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS handoff_from_agent_id TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS handoff_to_agent_id TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS content_format TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS mime_type TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS file_name TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS content_text TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS content_json JSONB;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS downloadable BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS trace_id TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS latency_ms INTEGER;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12,6);

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS policy_decision_id TEXT;

ALTER TABLE capability_artifacts
    ADD COLUMN IF NOT EXISTS retrieval_references JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS run_id TEXT;

ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS run_step_id TEXT;

ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS tool_invocation_id TEXT;

ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS trace_id TEXT;

ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS latency_ms INTEGER;

ALTER TABLE capability_execution_logs
    ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12,6);

ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS trace_id TEXT;

ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS current_node_id TEXT;

ALTER TABLE capability_workflow_runs
    ADD COLUMN IF NOT EXISTS branch_state JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE capability_workflow_run_steps
    ADD COLUMN IF NOT EXISTS span_id TEXT;

ALTER TABLE capability_workflow_run_steps
    ADD COLUMN IF NOT EXISTS workflow_node_id TEXT;

UPDATE capability_workflow_run_steps
    SET workflow_node_id = workflow_step_id
    WHERE workflow_node_id IS NULL;

ALTER TABLE capability_workflow_run_steps
    ADD COLUMN IF NOT EXISTS retrieval_references JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS trace_id TEXT;

ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS span_id TEXT;

ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS sandbox_profile TEXT;

ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS policy_decision_id TEXT;

ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS latency_ms INTEGER;

ALTER TABLE capability_tool_invocations
    ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12,6);

ALTER TABLE capability_run_events
    ADD COLUMN IF NOT EXISTS trace_id TEXT;

ALTER TABLE capability_run_events
    ADD COLUMN IF NOT EXISTS span_id TEXT;

ALTER TABLE capability_run_waits
    ADD COLUMN IF NOT EXISTS trace_id TEXT;

ALTER TABLE capability_run_waits
    ADD COLUMN IF NOT EXISTS span_id TEXT;

CREATE INDEX IF NOT EXISTS capability_workflow_runs_status_idx
    ON capability_workflow_runs (status, updated_at);

CREATE INDEX IF NOT EXISTS capability_workflow_runs_work_item_idx
    ON capability_workflow_runs (capability_id, work_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS capability_run_events_run_idx
    ON capability_run_events (capability_id, run_id, created_at ASC);

CREATE INDEX IF NOT EXISTS capability_run_waits_run_idx
    ON capability_run_waits (capability_id, run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS capability_artifacts_work_item_idx
    ON capability_artifacts (capability_id, work_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS capability_artifacts_run_idx
    ON capability_artifacts (capability_id, source_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS capability_trace_spans_trace_idx
    ON capability_trace_spans (capability_id, trace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS capability_metric_samples_scope_idx
    ON capability_metric_samples (capability_id, scope_type, scope_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS capability_policy_decisions_run_idx
    ON capability_policy_decisions (capability_id, run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS capability_memory_documents_source_idx
    ON capability_memory_documents (capability_id, source_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS capability_memory_chunks_document_idx
    ON capability_memory_chunks (capability_id, document_id, chunk_index ASC);

CREATE INDEX IF NOT EXISTS capability_memory_embeddings_chunk_idx
    ON capability_memory_embeddings (capability_id, chunk_id);

CREATE INDEX IF NOT EXISTS capability_eval_runs_suite_idx
    ON capability_eval_runs (capability_id, suite_id, created_at DESC);

CREATE INDEX IF NOT EXISTS capability_agent_learning_jobs_status_idx
    ON capability_agent_learning_jobs (status, requested_at ASC);

CREATE INDEX IF NOT EXISTS capability_agent_learning_jobs_agent_idx
    ON capability_agent_learning_jobs (capability_id, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS capability_agent_sessions_agent_idx
    ON capability_agent_sessions (capability_id, agent_id, last_used_at DESC);

-- Optional pgvector acceleration. Safe to leave in place on instances without pgvector.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION
    WHEN undefined_file THEN
      RAISE NOTICE 'pgvector is not available; skipping vector extension.';
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'capability_memory_embeddings'
        AND column_name = 'embedding_vector'
    ) THEN
      EXECUTE 'ALTER TABLE capability_memory_embeddings ADD COLUMN embedding_vector vector(64)';
    END IF;

    EXECUTE 'CREATE INDEX IF NOT EXISTS capability_memory_embeddings_vector_idx ON capability_memory_embeddings USING hnsw (embedding_vector vector_cosine_ops)';
  ELSE
    RAISE NOTICE 'pgvector extension is not installed; using JSON embedding storage only.';
  END IF;
END $$;

COMMIT;
