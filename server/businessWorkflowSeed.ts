/**
 * Demo Business Workflow seed.
 *
 * Installed by `initializeSeedData()` (server/repository.ts) when
 * ENABLE_DEMO_SEED is set. Idempotent: stable template id +
 * INSERT … ON CONFLICT DO NOTHING means re-runs don't duplicate.
 *
 * The seeded template is a 12-node EMPLOYEE ONBOARDING workflow that
 * intentionally exercises every notable feature of the runtime so a
 * fresh dev environment has something meaningful to click:
 *
 *   - START          carries a structured `formSchema` so the launch
 *                    dialog renders real fields (employee name, role,
 *                    start date, requires_security_review flag).
 *   - FORM_FILL      collects equipment requirements; writes selected
 *                    items into instance.context via outputBindings.
 *   - APPROVAL       HR Director approves with all 7 decision states
 *                    available; rejected path lands at END_REJECTED.
 *   - DECISION_GATE  branches on params.requires_security_review.
 *   - HUMAN_TASK     Security review (engineering hires only). Carries
 *                    priority=HIGH, slaMinutes=24*60, and an ATTACHED
 *                    TIMER (fires NOTIFY to HR Director 23h in if the
 *                    task hasn't been claimed) — exercises the V2.1
 *                    sweep worker out of the box.
 *   - PARALLEL_FORK  splits IT vs Facilities provisioning.
 *   - HUMAN_TASK     IT Provisioning (slaMinutes=4h, priority=HIGH).
 *   - HUMAN_TASK     Facilities Setup (slaMinutes=48h, priority=NORMAL).
 *   - PARALLEL_JOIN  waits for both parallel branches.
 *   - NOTIFICATION   welcome email to the new hire and their manager.
 *   - END / END_REJECTED — two terminal nodes so the canvas reads
 *                    naturally.
 *
 * The graph is published as version 1 so "Start instance" is enabled
 * immediately. The same JSON is also written to draft_* so an
 * operator opening the designer sees the live graph (not an empty
 * draft).
 */

import type { PoolClient } from "pg";
import type {
  BusinessEdge,
  BusinessNode,
  BusinessPhase,
} from "../src/contracts/businessWorkflow";

// Stable id so re-runs of the seed don't duplicate the row.
const DEMO_TEMPLATE_ID = "BWT-DEMO-ONBOARDING";

/**
 * Build the full BusinessNode array. Returned as a fresh array each
 * call so the seed can append per-capability tweaks if we ever want
 * that.
 */
const buildDemoNodes = (): BusinessNode[] => [
  // ── START ────────────────────────────────────────────────────────────────
  {
    id: "start",
    type: "START",
    label: "New hire intake",
    position: { x: 80, y: 240 },
    config: {
      description:
        "Kick off when HR receives the signed offer letter. The launch dialog collects the employee's basic info.",
      // Structured form schema — the launch dialog renders these as
      // real inputs.
      formSchema: {
        fields: [
          {
            key: "employeeName",
            label: "Employee name",
            placeholder: "Jane Doe",
            required: true,
          },
          {
            key: "role",
            label: "Role title",
            placeholder: "Senior Software Engineer",
            required: true,
          },
          {
            key: "startDate",
            label: "Start date",
            placeholder: "2026-06-01",
            required: true,
          },
          {
            key: "requiresSecurityReview",
            label:
              "Requires security review? (engineering / data / SRE roles — type 'yes' or 'no')",
            defaultValue: "no",
          },
        ],
      },
    },
  },

  // ── FORM_FILL: equipment package ─────────────────────────────────────────
  {
    id: "form_fill_equipment",
    type: "FORM_FILL",
    label: "Equipment package",
    position: { x: 320, y: 240 },
    config: {
      description:
        "Hiring manager confirms the equipment package the new hire needs.",
      assignment: {
        mode: "ROLE_BASED",
        role: "TEAM_LEAD",
      },
      priority: "NORMAL",
      slaMinutes: 24 * 60,
      formSchema: {
        fields: [
          {
            key: "laptopModel",
            label: "Laptop model",
            placeholder: "MacBook Pro 14 / Dell XPS / ThinkPad X1",
            required: true,
          },
          {
            key: "monitorCount",
            label: "Monitors (0 / 1 / 2)",
            defaultValue: "1",
          },
          {
            key: "extraEquipment",
            label: "Extra equipment / notes",
            multiline: true,
            placeholder: "e.g. standing desk, headset…",
          },
        ],
      },
      outputBindings: [
        // Mirror the form fields into context.equipment.* so
        // downstream nodes (and humans on the dashboard) can read
        // them as a clean nested object.
        { name: "laptopModel", contextPath: "equipment.laptop" },
        { name: "monitorCount", contextPath: "equipment.monitors" },
        { name: "extraEquipment", contextPath: "equipment.extras" },
      ],
    },
  },

  // ── APPROVAL: HR Director ────────────────────────────────────────────────
  {
    id: "approval_hr",
    type: "APPROVAL",
    label: "HR Director approval",
    position: { x: 560, y: 240 },
    config: {
      description:
        "HR Director reviews the package and approves, requests changes, or rejects.",
      assignment: {
        mode: "ROLE_BASED",
        role: "PORTFOLIO_OWNER",
      },
      priority: "HIGH",
      slaMinutes: 4 * 60,
      // Surface every approval state so the demo shows the full
      // outcome menu.
      allowedDecisionStatuses: [
        "APPROVED",
        "APPROVED_WITH_CONDITIONS",
        "REJECTED",
        "NEEDS_MORE_INFORMATION",
        "DEFERRED",
        "ESCALATED",
      ],
    },
  },

  // ── DECISION_GATE: route by security flag ────────────────────────────────
  {
    id: "gate_role",
    type: "DECISION_GATE",
    label: "Needs security review?",
    position: { x: 800, y: 240 },
    config: {
      description:
        "Branches on params.requiresSecurityReview — engineering / data / SRE hires take the security review leg.",
      defaultEdgeId: "edge_gate_default",
    },
  },

  // ── HUMAN_TASK: Security review (skipped on default branch) ──────────────
  {
    id: "task_security",
    type: "HUMAN_TASK",
    label: "Security review",
    position: { x: 1040, y: 120 },
    config: {
      description:
        "Confirm SSO group memberships, VPN profile, prod access scope.",
      assignment: {
        mode: "ROLE_BASED",
        role: "INCIDENT_COMMANDER",
      },
      priority: "HIGH",
      slaMinutes: 24 * 60,
      attachments: [
        {
          id: "att-sec-timer",
          type: "TIMER",
          enabled: true,
          label: "Nudge HR if not picked up in 23h",
          durationMinutes: 23 * 60,
          onFire: "NOTIFY",
          channel: "IN_APP",
          recipients: ["role:PORTFOLIO_OWNER"],
          message: "Security review for ${context.employeeName} hasn't been claimed yet.",
        },
        {
          id: "att-sec-notify-on-activate",
          type: "NOTIFICATION",
          enabled: true,
          label: "Notify SRE channel on activation",
          trigger: "ON_ACTIVATE",
          channel: "IN_APP",
          recipients: ["role:INCIDENT_COMMANDER"],
          message: "New security review pending: ${context.employeeName}",
        },
      ],
    },
  },

  // ── PARALLEL_FORK: provisioning split ────────────────────────────────────
  {
    id: "fork_provision",
    type: "PARALLEL_FORK",
    label: "Begin provisioning",
    position: { x: 1280, y: 240 },
    config: {
      description: "Start IT provisioning and Facilities setup in parallel.",
    },
  },

  // ── HUMAN_TASK: IT Provisioning ──────────────────────────────────────────
  {
    id: "task_it",
    type: "HUMAN_TASK",
    label: "IT provisioning",
    position: { x: 1520, y: 120 },
    config: {
      description:
        "Order laptop, create accounts (Okta, GitHub, JIRA), enrol in MDM. Reads context.equipment.*.",
      assignment: {
        mode: "TEAM_QUEUE",
      },
      priority: "HIGH",
      slaMinutes: 4 * 60,
    },
  },

  // ── HUMAN_TASK: Facilities Setup ─────────────────────────────────────────
  {
    id: "task_facilities",
    type: "HUMAN_TASK",
    label: "Facilities setup",
    position: { x: 1520, y: 360 },
    config: {
      description:
        "Office desk assignment, badge printing, locker. Skipped for fully remote hires (out of scope V1).",
      assignment: {
        mode: "TEAM_QUEUE",
      },
      priority: "NORMAL",
      slaMinutes: 48 * 60,
    },
  },

  // ── PARALLEL_JOIN ────────────────────────────────────────────────────────
  {
    id: "join_provision",
    type: "PARALLEL_JOIN",
    label: "Wait for both branches",
    position: { x: 1760, y: 240 },
    config: {
      description: "Block until IT and Facilities both report COMPLETED.",
    },
  },

  // ── NOTIFICATION: welcome email ──────────────────────────────────────────
  {
    id: "notify_welcome",
    type: "NOTIFICATION",
    label: "Welcome email",
    position: { x: 2000, y: 240 },
    config: {
      description:
        "Send the welcome email to the new hire and their manager. V1: in-app event only.",
      notificationChannel: "EMAIL",
      notificationRecipients: ["role:OPERATOR"],
    },
  },

  // ── END (success) ────────────────────────────────────────────────────────
  {
    id: "end_done",
    type: "END",
    label: "Onboarded",
    position: { x: 2240, y: 240 },
    config: {
      description: "Happy path — instance completes COMPLETED.",
    },
  },

  // ── END_REJECTED ─────────────────────────────────────────────────────────
  {
    id: "end_rejected",
    type: "END",
    label: "Cancelled at HR",
    position: { x: 560, y: 480 },
    config: {
      description:
        "HR rejected the package. Instance completes — no provisioning happens.",
    },
  },
];

/**
 * Build the edges. Two conditional edges off the approval (approved
 * vs rejected) and two off the decision gate (requires-security vs
 * default).
 */
const buildDemoEdges = (): BusinessEdge[] => [
  {
    id: "edge_start_form",
    sourceNodeId: "start",
    targetNodeId: "form_fill_equipment",
  },
  {
    id: "edge_form_approval",
    sourceNodeId: "form_fill_equipment",
    targetNodeId: "approval_hr",
  },
  // Approval → decision gate (only when APPROVED).
  {
    id: "edge_approval_gate",
    sourceNodeId: "approval_hr",
    targetNodeId: "gate_role",
    label: "approved",
    condition: {
      logic: "OR",
      clauses: [
        { left: "decision", op: "eq", right: "APPROVED" },
        { left: "decision", op: "eq", right: "APPROVED_WITH_CONDITIONS" },
      ],
    },
  },
  // Approval → end_rejected.
  {
    id: "edge_approval_rejected",
    sourceNodeId: "approval_hr",
    targetNodeId: "end_rejected",
    label: "rejected",
    condition: {
      logic: "AND",
      clauses: [{ left: "decision", op: "eq", right: "REJECTED" }],
    },
  },
  // Gate → security review (when role flagged).
  {
    id: "edge_gate_security",
    sourceNodeId: "gate_role",
    targetNodeId: "task_security",
    label: "requires security review",
    condition: {
      logic: "OR",
      clauses: [
        { left: "params.requiresSecurityReview", op: "eq", right: "yes" },
        { left: "requiresSecurityReview", op: "eq", right: "yes" },
      ],
    },
  },
  // Gate default → straight to provisioning.
  {
    id: "edge_gate_default",
    sourceNodeId: "gate_role",
    targetNodeId: "fork_provision",
    label: "default",
  },
  // Security → provisioning.
  {
    id: "edge_security_fork",
    sourceNodeId: "task_security",
    targetNodeId: "fork_provision",
  },
  // Fork branches.
  {
    id: "edge_fork_it",
    sourceNodeId: "fork_provision",
    targetNodeId: "task_it",
  },
  {
    id: "edge_fork_facilities",
    sourceNodeId: "fork_provision",
    targetNodeId: "task_facilities",
  },
  // Branches → join.
  {
    id: "edge_it_join",
    sourceNodeId: "task_it",
    targetNodeId: "join_provision",
  },
  {
    id: "edge_facilities_join",
    sourceNodeId: "task_facilities",
    targetNodeId: "join_provision",
  },
  // Join → notify → end.
  {
    id: "edge_join_notify",
    sourceNodeId: "join_provision",
    targetNodeId: "notify_welcome",
  },
  {
    id: "edge_notify_end",
    sourceNodeId: "notify_welcome",
    targetNodeId: "end_done",
  },
];

const buildDemoPhases = (): BusinessPhase[] => [
  // Phases are visual swimlanes. Even with the V1 minimal phase
  // support they make the canvas read like a process map.
  { id: "phase_intake", name: "Intake", displayOrder: 0, color: "#38bdf8" },
  { id: "phase_review", name: "Review", displayOrder: 1, color: "#a78bfa" },
  {
    id: "phase_provision",
    name: "Provisioning",
    displayOrder: 2,
    color: "#22c55e",
  },
  {
    id: "phase_complete",
    name: "Complete",
    displayOrder: 3,
    color: "#64748b",
  },
];

/**
 * Idempotent insert. Re-runs of the seed are safe: stable id +
 * ON CONFLICT DO NOTHING on both the templates row and the version
 * row.
 *
 * Called from inside `initializeSeedData`'s transaction so we share
 * the same client + commit fate.
 */
export const seedDemoBusinessWorkflowsTx = async (
  client: PoolClient,
  capabilityIds: readonly string[],
  publishedBy: string = "system:seed",
): Promise<void> => {
  if (capabilityIds.length === 0) return;
  const nodes = buildDemoNodes();
  const edges = buildDemoEdges();
  const phases = buildDemoPhases();
  const nodesJson = JSON.stringify(nodes);
  const edgesJson = JSON.stringify(edges);
  const phasesJson = JSON.stringify(phases);

  for (const capabilityId of capabilityIds) {
    // Templates row — published, current_version=1, draft mirrors v1
    // so the designer opens to the same graph.
    await client.query(
      `
      INSERT INTO capability_business_workflow_templates
        (capability_id, id, name, description, status, current_version,
         draft_nodes, draft_edges, draft_phases, metadata)
      VALUES ($1, $2, $3, $4, 'PUBLISHED', 1,
              $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
      ON CONFLICT (capability_id, id) DO NOTHING
      `,
      [
        capabilityId,
        DEMO_TEMPLATE_ID,
        "Employee onboarding (demo)",
        "End-to-end new-hire onboarding. Demonstrates START launch form, FORM_FILL with output bindings, APPROVAL with branching outcomes, DECISION_GATE, PARALLEL_FORK + JOIN, attached TIMER + NOTIFICATION behaviors, and a NOTIFICATION boundary node. Seeded via ENABLE_DEMO_SEED.",
        nodesJson,
        edgesJson,
        phasesJson,
        JSON.stringify({ tags: ["demo", "onboarding"], origin: "seed" }),
      ],
    );

    // Version row — pin v1 to the same graph so Start instance works
    // straight away.
    await client.query(
      `
      INSERT INTO capability_business_workflow_template_versions
        (capability_id, template_id, version, nodes, edges, phases, published_by)
      VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5::jsonb, $6)
      ON CONFLICT (capability_id, template_id, version) DO NOTHING
      `,
      [capabilityId, DEMO_TEMPLATE_ID, nodesJson, edgesJson, phasesJson, publishedBy],
    );
  }
};
