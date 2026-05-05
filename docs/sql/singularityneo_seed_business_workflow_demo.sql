-- ════════════════════════════════════════════════════════════════════════════
-- Singularity Neo — Demo Business Workflow seed
-- ════════════════════════════════════════════════════════════════════════════
--
-- Inserts a 12-node "Employee onboarding" demo template against the
-- capability of your choice. Idempotent — stable id `BWT-DEMO-ONBOARDING`
-- with ON CONFLICT DO NOTHING means re-runs do nothing.
--
-- Demonstrates every notable runtime feature in one click:
--
--   - START          structured launch form (text / date / boolean) so
--                    the launch dialog renders real fields.
--   - FORM_FILL      equipment package with a 4-option choice dropdown,
--                    a number, and a longtext field. Output bindings
--                    mirror values into context.equipment.*.
--   - APPROVAL       HR Director approval with all 7 decision states.
--   - DECISION_GATE  branches on the boolean security-review flag.
--   - HUMAN_TASK     security review with priority=HIGH + slaMinutes=24h
--                    AND an attached TIMER (fires NOTIFY at the 23h
--                    mark) — exercises the V2.1 sweep worker.
--   - PARALLEL_FORK  splits IT vs Facilities provisioning.
--   - HUMAN_TASK ×2  IT (4h) + Facilities (48h).
--   - PARALLEL_JOIN  waits for both branches.
--   - NOTIFICATION   welcome email boundary node.
--   - END / END      success + rejected terminals so the canvas reads.
--
-- Status is PUBLISHED with current_version=1; the v1 row is also
-- inserted so "Start instance" lights up immediately. The same JSON
-- is mirrored into draft_* so the designer opens to the live graph.
--
-- ── Usage ───────────────────────────────────────────────────────────────────
--
-- 1. Set the target capability id either via psql variable or sed:
--
--    psql -v capability_id='YOUR_CAP_ID' -f singularityneo_seed_business_workflow_demo.sql
--
--    or:
--
--    sed 's/:capability_id/YOUR_CAP_ID/g' \
--      singularityneo_seed_business_workflow_demo.sql | psql
--
-- 2. (Optional) Set a different `published_by`:
--
--    psql -v capability_id='YOUR_CAP_ID' -v published_by='alice' \
--      -f singularityneo_seed_business_workflow_demo.sql
--
-- 3. Restart the renderer (or refresh) and navigate to:
--      /studio/business-workflows
--    The new "Employee onboarding (demo)" template appears at v1
--    PUBLISHED. Click "Start instance" → fill the launch form → drive
--    it through.
--
-- ── Removing ────────────────────────────────────────────────────────────────
--
--   DELETE FROM capability_business_workflow_templates
--    WHERE capability_id = :'capability_id'
--      AND id = 'BWT-DEMO-ONBOARDING';
--   -- CASCADE drops version + any instances you started.
--
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- Defaults so you can run with `psql -f` and no -v at all (tests).
\if :{?capability_id}
\else
  \set capability_id 'demo-capability'
\endif
\if :{?published_by}
\else
  \set published_by 'system:seed'
\endif

\echo Seeding demo business workflow into capability=:'capability_id'

BEGIN;

-- ── Templates row ───────────────────────────────────────────────────────────
INSERT INTO capability_business_workflow_templates
  (capability_id, id, name, description, status, current_version,
   draft_nodes, draft_edges, draft_phases, metadata)
VALUES (
  :'capability_id',
  'BWT-DEMO-ONBOARDING',
  'Employee onboarding (demo)',
  'End-to-end new-hire onboarding. Demonstrates START launch form, FORM_FILL with output bindings, APPROVAL with branching outcomes, DECISION_GATE, PARALLEL_FORK + JOIN, attached TIMER + NOTIFICATION behaviors, and a NOTIFICATION boundary node.',
  'PUBLISHED',
  1,
  -- ── nodes ─────────────────────────────────────────────────────────────────
  $nodes$[
    {
      "id": "start",
      "type": "START",
      "label": "New hire intake",
      "position": { "x": 80, "y": 240 },
      "config": {
        "description": "Kick off when HR receives the signed offer letter.",
        "formSchema": {
          "fields": [
            { "key": "employeeName", "label": "Employee name", "type": "text", "placeholder": "Jane Doe", "required": true },
            { "key": "role", "label": "Role title", "type": "text", "placeholder": "Senior Software Engineer", "required": true },
            { "key": "startDate", "label": "Start date", "type": "date", "required": true },
            { "key": "requiresSecurityReview", "label": "Requires security review?", "type": "boolean", "helpText": "Engineering / Data / SRE roles need an SSO + prod-access review.", "defaultValue": "no" }
          ]
        }
      }
    },
    {
      "id": "form_fill_equipment",
      "type": "FORM_FILL",
      "label": "Equipment package",
      "position": { "x": 320, "y": 240 },
      "config": {
        "description": "Hiring manager confirms the equipment package.",
        "assignment": { "mode": "ROLE_BASED", "role": "TEAM_LEAD" },
        "priority": "NORMAL",
        "slaMinutes": 1440,
        "formSchema": {
          "fields": [
            {
              "key": "laptopModel",
              "label": "Laptop model",
              "type": "choice",
              "required": true,
              "options": [
                { "value": "macbook_pro_14", "label": "MacBook Pro 14\""  },
                { "value": "macbook_pro_16", "label": "MacBook Pro 16\""  },
                { "value": "dell_xps", "label": "Dell XPS 15" },
                { "value": "thinkpad_x1", "label": "ThinkPad X1 Carbon" }
              ]
            },
            { "key": "monitorCount", "label": "Monitors", "type": "number", "defaultValue": "1", "helpText": "0, 1, or 2." },
            { "key": "extraEquipment", "label": "Extra equipment / notes", "type": "longtext", "placeholder": "e.g. standing desk, headset…" }
          ]
        },
        "outputBindings": [
          { "name": "laptopModel", "contextPath": "equipment.laptop" },
          { "name": "monitorCount", "contextPath": "equipment.monitors" },
          { "name": "extraEquipment", "contextPath": "equipment.extras" }
        ]
      }
    },
    {
      "id": "approval_hr",
      "type": "APPROVAL",
      "label": "HR Director approval",
      "position": { "x": 560, "y": 240 },
      "config": {
        "description": "HR reviews the package and decides.",
        "assignment": { "mode": "ROLE_BASED", "role": "PORTFOLIO_OWNER" },
        "priority": "HIGH",
        "slaMinutes": 240,
        "allowedDecisionStatuses": [
          "APPROVED",
          "APPROVED_WITH_CONDITIONS",
          "REJECTED",
          "NEEDS_MORE_INFORMATION",
          "DEFERRED",
          "ESCALATED"
        ]
      }
    },
    {
      "id": "gate_role",
      "type": "DECISION_GATE",
      "label": "Needs security review?",
      "position": { "x": 800, "y": 240 },
      "config": {
        "description": "Branches on params.requiresSecurityReview.",
        "defaultEdgeId": "edge_gate_default"
      }
    },
    {
      "id": "task_security",
      "type": "HUMAN_TASK",
      "label": "Security review",
      "position": { "x": 1040, "y": 120 },
      "config": {
        "description": "Confirm SSO group memberships, VPN profile, prod access scope.",
        "assignment": { "mode": "ROLE_BASED", "role": "INCIDENT_COMMANDER" },
        "priority": "HIGH",
        "slaMinutes": 1440,
        "attachments": [
          {
            "id": "att-sec-timer",
            "type": "TIMER",
            "enabled": true,
            "label": "Nudge HR if not picked up in 23h",
            "durationMinutes": 1380,
            "onFire": "NOTIFY",
            "channel": "IN_APP",
            "recipients": ["role:PORTFOLIO_OWNER"],
            "message": "Security review for ${context.employeeName} hasn't been claimed yet."
          }
        ]
      }
    },
    {
      "id": "fork_provision",
      "type": "PARALLEL_FORK",
      "label": "Begin provisioning",
      "position": { "x": 1280, "y": 240 },
      "config": { "description": "Start IT and Facilities setup in parallel." }
    },
    {
      "id": "task_it",
      "type": "HUMAN_TASK",
      "label": "IT provisioning",
      "position": { "x": 1520, "y": 120 },
      "config": {
        "description": "Order laptop, create accounts (Okta, GitHub, JIRA), enrol in MDM.",
        "assignment": { "mode": "TEAM_QUEUE" },
        "priority": "HIGH",
        "slaMinutes": 240
      }
    },
    {
      "id": "task_facilities",
      "type": "HUMAN_TASK",
      "label": "Facilities setup",
      "position": { "x": 1520, "y": 360 },
      "config": {
        "description": "Office desk, badge, locker.",
        "assignment": { "mode": "TEAM_QUEUE" },
        "priority": "NORMAL",
        "slaMinutes": 2880
      }
    },
    {
      "id": "join_provision",
      "type": "PARALLEL_JOIN",
      "label": "Wait for both branches",
      "position": { "x": 1760, "y": 240 },
      "config": { "description": "Block until IT and Facilities both COMPLETED." }
    },
    {
      "id": "notify_welcome",
      "type": "NOTIFICATION",
      "label": "Welcome email",
      "position": { "x": 2000, "y": 240 },
      "config": {
        "description": "Send the welcome email.",
        "notificationChannel": "EMAIL",
        "notificationRecipients": ["role:OPERATOR"]
      }
    },
    {
      "id": "end_done",
      "type": "END",
      "label": "Onboarded",
      "position": { "x": 2240, "y": 240 },
      "config": { "description": "Happy path." }
    },
    {
      "id": "end_rejected",
      "type": "END",
      "label": "Cancelled at HR",
      "position": { "x": 560, "y": 480 },
      "config": { "description": "HR rejected the package." }
    }
  ]$nodes$::jsonb,
  -- ── edges ─────────────────────────────────────────────────────────────────
  $edges$[
    { "id": "edge_start_form", "sourceNodeId": "start", "targetNodeId": "form_fill_equipment" },
    { "id": "edge_form_approval", "sourceNodeId": "form_fill_equipment", "targetNodeId": "approval_hr" },
    {
      "id": "edge_approval_gate",
      "sourceNodeId": "approval_hr",
      "targetNodeId": "gate_role",
      "label": "approved",
      "condition": {
        "logic": "OR",
        "clauses": [
          { "left": "decision", "op": "eq", "right": "APPROVED" },
          { "left": "decision", "op": "eq", "right": "APPROVED_WITH_CONDITIONS" }
        ]
      }
    },
    {
      "id": "edge_approval_rejected",
      "sourceNodeId": "approval_hr",
      "targetNodeId": "end_rejected",
      "label": "rejected",
      "condition": {
        "logic": "AND",
        "clauses": [{ "left": "decision", "op": "eq", "right": "REJECTED" }]
      }
    },
    {
      "id": "edge_gate_security",
      "sourceNodeId": "gate_role",
      "targetNodeId": "task_security",
      "label": "requires security review",
      "condition": {
        "logic": "OR",
        "clauses": [
          { "left": "params.requiresSecurityReview", "op": "eq", "right": "yes" },
          { "left": "requiresSecurityReview", "op": "eq", "right": "yes" }
        ]
      }
    },
    {
      "id": "edge_gate_default",
      "sourceNodeId": "gate_role",
      "targetNodeId": "fork_provision",
      "label": "default"
    },
    { "id": "edge_security_fork", "sourceNodeId": "task_security", "targetNodeId": "fork_provision" },
    { "id": "edge_fork_it", "sourceNodeId": "fork_provision", "targetNodeId": "task_it" },
    { "id": "edge_fork_facilities", "sourceNodeId": "fork_provision", "targetNodeId": "task_facilities" },
    { "id": "edge_it_join", "sourceNodeId": "task_it", "targetNodeId": "join_provision" },
    { "id": "edge_facilities_join", "sourceNodeId": "task_facilities", "targetNodeId": "join_provision" },
    { "id": "edge_join_notify", "sourceNodeId": "join_provision", "targetNodeId": "notify_welcome" },
    { "id": "edge_notify_end", "sourceNodeId": "notify_welcome", "targetNodeId": "end_done" }
  ]$edges$::jsonb,
  -- ── phases ────────────────────────────────────────────────────────────────
  $phases$[
    { "id": "phase_intake",   "name": "Intake",        "displayOrder": 0, "color": "#38bdf8" },
    { "id": "phase_review",   "name": "Review",        "displayOrder": 1, "color": "#a78bfa" },
    { "id": "phase_provision","name": "Provisioning",  "displayOrder": 2, "color": "#22c55e" },
    { "id": "phase_complete", "name": "Complete",      "displayOrder": 3, "color": "#64748b" }
  ]$phases$::jsonb,
  -- ── metadata ──────────────────────────────────────────────────────────────
  '{"tags":["demo","onboarding"],"origin":"sql-seed","complexity":"basic"}'::jsonb
)
ON CONFLICT (capability_id, id) DO NOTHING;

-- ── Pinned v1 version row (so Start instance is enabled) ────────────────────
INSERT INTO capability_business_workflow_template_versions
  (capability_id, template_id, version, nodes, edges, phases, published_by)
SELECT
  capability_id, id, 1, draft_nodes, draft_edges, draft_phases, :'published_by'
FROM capability_business_workflow_templates
WHERE capability_id = :'capability_id'
  AND id = 'BWT-DEMO-ONBOARDING'
ON CONFLICT (capability_id, template_id, version) DO NOTHING;

COMMIT;

\echo Done. Open /studio/business-workflows on the renderer to see it.
