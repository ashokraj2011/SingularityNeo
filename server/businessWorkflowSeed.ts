/**
 * Demo Business Workflow seeds.
 *
 * Installed by `initializeSeedData()` (server/repository.ts) when
 * ENABLE_DEMO_SEED is set. Idempotent: stable template ids + INSERT
 * … ON CONFLICT DO NOTHING means re-runs don't duplicate.
 *
 * Two templates ship today, both designed to exercise every notable
 * feature of the runtime so a fresh dev environment has something
 * meaningful to click:
 *
 *   1. BWT-DEMO-ONBOARDING — 12-node Employee Onboarding workflow.
 *      Showcases the basics: structured launch form, output
 *      bindings, dual ENDs (success + rejected), parallel
 *      provisioning, attached timer + notification.
 *
 *   2. BWT-DEMO-PROCUREMENT — 19-node Purchase Request workflow.
 *      Showcases the deep end: every form-field type (text /
 *      longtext / number / date / boolean / choice), three-tier
 *      approval routing by amount, parallel sourcing, conditional
 *      legal review, full PO lifecycle. Rich form schemas with
 *      help text and required fields.
 *
 * Both templates publish as version 1 with `draft_*` mirroring v1
 * so the designer opens to the live graph and "Start instance" is
 * enabled immediately.
 */

import type { PoolClient } from "pg";
import type {
  BusinessEdge,
  BusinessNode,
  BusinessPhase,
} from "../src/contracts/businessWorkflow";

interface DemoTemplateDefinition {
  id: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  nodes: BusinessNode[];
  edges: BusinessEdge[];
  phases: BusinessPhase[];
}

/**
 * Idempotent insert for one demo template into one capability.
 * Both templates use this — keeps the SQL plumbing in one place so
 * a schema tweak only needs to land here.
 */
const insertDemoTemplateTx = async (
  client: PoolClient,
  capabilityId: string,
  def: DemoTemplateDefinition,
  publishedBy: string,
): Promise<void> => {
  const nodesJson = JSON.stringify(def.nodes);
  const edgesJson = JSON.stringify(def.edges);
  const phasesJson = JSON.stringify(def.phases);

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
      def.id,
      def.name,
      def.description,
      nodesJson,
      edgesJson,
      phasesJson,
      JSON.stringify(def.metadata),
    ],
  );

  await client.query(
    `
    INSERT INTO capability_business_workflow_template_versions
      (capability_id, template_id, version, nodes, edges, phases, published_by)
    VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5::jsonb, $6)
    ON CONFLICT (capability_id, template_id, version) DO NOTHING
    `,
    [capabilityId, def.id, nodesJson, edgesJson, phasesJson, publishedBy],
  );
};

// ════════════════════════════════════════════════════════════════════════════
// Demo 1 — Employee Onboarding (basic)
// ════════════════════════════════════════════════════════════════════════════

const ONBOARDING_TEMPLATE_ID = "BWT-DEMO-ONBOARDING";

const buildOnboardingNodes = (): BusinessNode[] => [
  {
    id: "start",
    type: "START",
    label: "New hire intake",
    position: { x: 80, y: 240 },
    config: {
      description:
        "Kick off when HR receives the signed offer letter. The launch dialog collects the employee's basic info.",
      formSchema: {
        fields: [
          {
            key: "employeeName",
            label: "Employee name",
            type: "text",
            placeholder: "Jane Doe",
            required: true,
          },
          {
            key: "role",
            label: "Role title",
            type: "text",
            placeholder: "Senior Software Engineer",
            required: true,
          },
          {
            key: "startDate",
            label: "Start date",
            type: "date",
            required: true,
          },
          {
            key: "requiresSecurityReview",
            label: "Requires security review?",
            type: "boolean",
            helpText:
              "Engineering / Data / SRE roles need an SSO + prod-access review.",
            defaultValue: "no",
          },
        ],
      },
    },
  },
  {
    id: "form_fill_equipment",
    type: "FORM_FILL",
    label: "Equipment package",
    position: { x: 320, y: 240 },
    config: {
      description: "Hiring manager confirms the equipment package.",
      assignment: { mode: "ROLE_BASED", role: "TEAM_LEAD" },
      priority: "NORMAL",
      slaMinutes: 24 * 60,
      formSchema: {
        fields: [
          {
            key: "laptopModel",
            label: "Laptop model",
            type: "choice",
            required: true,
            options: [
              { value: "macbook_pro_14", label: "MacBook Pro 14\"" },
              { value: "macbook_pro_16", label: "MacBook Pro 16\"" },
              { value: "dell_xps", label: "Dell XPS 15" },
              { value: "thinkpad_x1", label: "ThinkPad X1 Carbon" },
            ],
          },
          {
            key: "monitorCount",
            label: "Monitors",
            type: "number",
            defaultValue: "1",
            helpText: "0, 1, or 2.",
          },
          {
            key: "extraEquipment",
            label: "Extra equipment / notes",
            type: "longtext",
            placeholder: "e.g. standing desk, headset…",
          },
        ],
      },
      outputBindings: [
        { name: "laptopModel", contextPath: "equipment.laptop" },
        { name: "monitorCount", contextPath: "equipment.monitors" },
        { name: "extraEquipment", contextPath: "equipment.extras" },
      ],
    },
  },
  {
    id: "approval_hr",
    type: "APPROVAL",
    label: "HR Director approval",
    position: { x: 560, y: 240 },
    config: {
      description: "HR reviews the package and decides.",
      assignment: { mode: "ROLE_BASED", role: "PORTFOLIO_OWNER" },
      priority: "HIGH",
      slaMinutes: 4 * 60,
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
  {
    id: "gate_role",
    type: "DECISION_GATE",
    label: "Needs security review?",
    position: { x: 800, y: 240 },
    config: {
      description: "Branches on params.requiresSecurityReview.",
      defaultEdgeId: "edge_gate_default",
    },
  },
  {
    id: "task_security",
    type: "HUMAN_TASK",
    label: "Security review",
    position: { x: 1040, y: 120 },
    config: {
      description:
        "Confirm SSO group memberships, VPN profile, prod access scope.",
      assignment: { mode: "ROLE_BASED", role: "INCIDENT_COMMANDER" },
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
          message:
            "Security review for ${context.employeeName} hasn't been claimed yet.",
        },
      ],
    },
  },
  {
    id: "fork_provision",
    type: "PARALLEL_FORK",
    label: "Begin provisioning",
    position: { x: 1280, y: 240 },
    config: { description: "Start IT and Facilities setup in parallel." },
  },
  {
    id: "task_it",
    type: "HUMAN_TASK",
    label: "IT provisioning",
    position: { x: 1520, y: 120 },
    config: {
      description:
        "Order laptop, create accounts (Okta, GitHub, JIRA), enrol in MDM.",
      assignment: { mode: "TEAM_QUEUE" },
      priority: "HIGH",
      slaMinutes: 4 * 60,
    },
  },
  {
    id: "task_facilities",
    type: "HUMAN_TASK",
    label: "Facilities setup",
    position: { x: 1520, y: 360 },
    config: {
      description: "Office desk, badge, locker.",
      assignment: { mode: "TEAM_QUEUE" },
      priority: "NORMAL",
      slaMinutes: 48 * 60,
    },
  },
  {
    id: "join_provision",
    type: "PARALLEL_JOIN",
    label: "Wait for both branches",
    position: { x: 1760, y: 240 },
    config: { description: "Block until IT and Facilities both COMPLETED." },
  },
  {
    id: "notify_welcome",
    type: "NOTIFICATION",
    label: "Welcome email",
    position: { x: 2000, y: 240 },
    config: {
      description: "Send the welcome email.",
      notificationChannel: "EMAIL",
      notificationRecipients: ["role:OPERATOR"],
    },
  },
  {
    id: "end_done",
    type: "END",
    label: "Onboarded",
    position: { x: 2240, y: 240 },
    config: { description: "Happy path." },
  },
  {
    id: "end_rejected",
    type: "END",
    label: "Cancelled at HR",
    position: { x: 560, y: 480 },
    config: { description: "HR rejected the package." },
  },
];

const buildOnboardingEdges = (): BusinessEdge[] => [
  { id: "edge_start_form", sourceNodeId: "start", targetNodeId: "form_fill_equipment" },
  { id: "edge_form_approval", sourceNodeId: "form_fill_equipment", targetNodeId: "approval_hr" },
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
  {
    id: "edge_gate_default",
    sourceNodeId: "gate_role",
    targetNodeId: "fork_provision",
    label: "default",
  },
  { id: "edge_security_fork", sourceNodeId: "task_security", targetNodeId: "fork_provision" },
  { id: "edge_fork_it", sourceNodeId: "fork_provision", targetNodeId: "task_it" },
  { id: "edge_fork_facilities", sourceNodeId: "fork_provision", targetNodeId: "task_facilities" },
  { id: "edge_it_join", sourceNodeId: "task_it", targetNodeId: "join_provision" },
  { id: "edge_facilities_join", sourceNodeId: "task_facilities", targetNodeId: "join_provision" },
  { id: "edge_join_notify", sourceNodeId: "join_provision", targetNodeId: "notify_welcome" },
  { id: "edge_notify_end", sourceNodeId: "notify_welcome", targetNodeId: "end_done" },
];

const onboardingDefinition = (): DemoTemplateDefinition => ({
  id: ONBOARDING_TEMPLATE_ID,
  name: "Employee onboarding (demo)",
  description:
    "End-to-end new-hire onboarding. Demonstrates START launch form, FORM_FILL with output bindings, APPROVAL with branching outcomes, DECISION_GATE, PARALLEL_FORK + JOIN, attached TIMER + NOTIFICATION behaviors, and a NOTIFICATION boundary node. Seeded via ENABLE_DEMO_SEED.",
  metadata: { tags: ["demo", "onboarding"], origin: "seed", complexity: "basic" },
  nodes: buildOnboardingNodes(),
  edges: buildOnboardingEdges(),
  phases: [
    { id: "phase_intake", name: "Intake", displayOrder: 0, color: "#38bdf8" },
    { id: "phase_review", name: "Review", displayOrder: 1, color: "#a78bfa" },
    { id: "phase_provision", name: "Provisioning", displayOrder: 2, color: "#22c55e" },
    { id: "phase_complete", name: "Complete", displayOrder: 3, color: "#64748b" },
  ],
});

// ════════════════════════════════════════════════════════════════════════════
// Demo 2 — Procurement / Purchase Request (deep end)
// ════════════════════════════════════════════════════════════════════════════

const PROCUREMENT_TEMPLATE_ID = "BWT-DEMO-PROCUREMENT";

const buildProcurementNodes = (): BusinessNode[] => [
  // ── Intake ──────────────────────────────────────────────────────────────
  {
    id: "start",
    type: "START",
    label: "Submit purchase request",
    position: { x: 80, y: 320 },
    config: {
      description:
        "Requester opens a PR. The launch form captures everything procurement needs to route the approval correctly.",
      formSchema: {
        fields: [
          {
            key: "requesterName",
            label: "Your name",
            type: "text",
            required: true,
            placeholder: "Jane Doe",
          },
          {
            key: "department",
            label: "Department",
            type: "choice",
            required: true,
            options: [
              { value: "engineering", label: "Engineering" },
              { value: "marketing", label: "Marketing" },
              { value: "sales", label: "Sales" },
              { value: "operations", label: "Operations" },
              { value: "finance", label: "Finance" },
              { value: "people", label: "People (HR)" },
            ],
          },
          {
            key: "itemDescription",
            label: "What you need",
            type: "longtext",
            required: true,
            placeholder: "10 Datadog Pro seats for the platform team",
            helpText:
              "Be specific. Include quantity, model, software edition, etc.",
          },
          {
            key: "amount",
            label: "Estimated total amount",
            type: "number",
            required: true,
            helpText: "USD. Three-tier approval routes off this number.",
          },
          {
            key: "currency",
            label: "Currency",
            type: "choice",
            defaultValue: "USD",
            options: [
              { value: "USD", label: "USD" },
              { value: "EUR", label: "EUR" },
              { value: "GBP", label: "GBP" },
              { value: "INR", label: "INR" },
            ],
          },
          {
            key: "neededByDate",
            label: "Needed by",
            type: "date",
            required: true,
          },
          {
            key: "isCapex",
            label: "Capital expenditure?",
            type: "boolean",
            defaultValue: "no",
            helpText:
              "Yes for fixed assets > 1 year useful life. Routes to CFO regardless of amount.",
          },
        ],
      },
    },
  },

  // ── Justification ───────────────────────────────────────────────────────
  {
    id: "form_fill_justify",
    type: "FORM_FILL",
    label: "Justification & vendor",
    position: { x: 320, y: 320 },
    config: {
      description:
        "Requester provides a business case and vendor preference. Read by approvers + procurement.",
      assignment: { mode: "DIRECT_USER" },
      priority: "NORMAL",
      slaMinutes: 24 * 60,
      formSchema: {
        fields: [
          {
            key: "businessReason",
            label: "Business reason",
            type: "longtext",
            required: true,
            placeholder:
              "Why this purchase, expected ROI, alternatives considered…",
          },
          {
            key: "suggestedVendor",
            label: "Preferred vendor (if any)",
            type: "text",
            placeholder: "Datadog Inc.",
          },
          {
            key: "alternativeVendors",
            label: "Alternative vendors evaluated",
            type: "longtext",
            placeholder: "New Relic, Grafana Cloud — list and why not",
          },
          {
            key: "urgency",
            label: "Urgency",
            type: "choice",
            defaultValue: "normal",
            options: [
              { value: "low", label: "Low — flexible" },
              { value: "normal", label: "Normal — within sprint" },
              { value: "high", label: "High — blocking work" },
              { value: "critical", label: "Critical — outage / compliance" },
            ],
          },
          {
            key: "willRecur",
            label: "Recurring spend?",
            type: "boolean",
            defaultValue: "no",
            helpText: "Annual licenses → yes. One-off purchase → no.",
          },
        ],
      },
      outputBindings: [
        { name: "businessReason", contextPath: "request.reason" },
        { name: "suggestedVendor", contextPath: "request.preferredVendor" },
        { name: "urgency", contextPath: "request.urgency" },
      ],
    },
  },

  // ── Three-tier approval routing ─────────────────────────────────────────
  {
    id: "gate_amount",
    type: "DECISION_GATE",
    label: "Route by amount",
    position: { x: 560, y: 320 },
    config: {
      description:
        "< $5K → Manager, $5K–$50K → Director, > $50K or capex → CFO.",
      defaultEdgeId: "edge_amount_l3",
    },
  },
  {
    id: "approval_l1",
    type: "APPROVAL",
    label: "Manager approval (L1)",
    position: { x: 800, y: 120 },
    config: {
      description:
        "Direct manager approves small purchases. SLA 4h with a nudge timer.",
      assignment: { mode: "ROLE_BASED", role: "TEAM_LEAD" },
      priority: "HIGH",
      slaMinutes: 4 * 60,
      allowedDecisionStatuses: [
        "APPROVED",
        "APPROVED_WITH_CONDITIONS",
        "REJECTED",
        "NEEDS_MORE_INFORMATION",
      ],
      attachments: [
        {
          id: "att-l1-nudge",
          type: "TIMER",
          enabled: true,
          label: "Nudge if not decided in 3h",
          durationMinutes: 3 * 60,
          onFire: "NOTIFY",
          channel: "IN_APP",
          recipients: ["role:TEAM_LEAD"],
          message:
            "PR for ${context.itemDescription} is awaiting your approval.",
        },
      ],
    },
  },
  {
    id: "approval_l2",
    type: "APPROVAL",
    label: "Director approval (L2)",
    position: { x: 800, y: 320 },
    config: {
      description:
        "Department director approves mid-tier spend. SLA 24h.",
      assignment: { mode: "ROLE_BASED", role: "PORTFOLIO_OWNER" },
      priority: "HIGH",
      slaMinutes: 24 * 60,
      allowedDecisionStatuses: [
        "APPROVED",
        "APPROVED_WITH_CONDITIONS",
        "REJECTED",
        "NEEDS_MORE_INFORMATION",
        "DEFERRED",
      ],
    },
  },
  {
    id: "approval_l3",
    type: "APPROVAL",
    label: "CFO approval (L3)",
    position: { x: 800, y: 520 },
    config: {
      description:
        "CFO approves high-value or capex spend. Full decision menu including ESCALATED.",
      assignment: { mode: "ROLE_BASED", role: "WORKSPACE_ADMIN" },
      priority: "URGENT",
      slaMinutes: 48 * 60,
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

  // ── Sourcing (parallel) ─────────────────────────────────────────────────
  {
    id: "fork_sourcing",
    type: "PARALLEL_FORK",
    label: "Sourcing",
    position: { x: 1040, y: 320 },
    config: { description: "Get quotes and verify budget in parallel." },
  },
  {
    id: "task_get_quotes",
    type: "HUMAN_TASK",
    label: "Collect vendor quotes",
    position: { x: 1280, y: 200 },
    config: {
      description:
        "Procurement reaches out to 2–3 vendors and attaches the quote PDFs to this instance's documents.",
      assignment: { mode: "TEAM_QUEUE" },
      priority: "NORMAL",
      slaMinutes: 5 * 24 * 60,
      formSchema: {
        fields: [
          {
            key: "quoteCount",
            label: "Quotes received",
            type: "number",
            required: true,
            helpText: "We aim for 3 unless single-source justified.",
          },
          {
            key: "lowestBid",
            label: "Lowest bid (USD)",
            type: "number",
            required: true,
          },
          {
            key: "highestBid",
            label: "Highest bid (USD)",
            type: "number",
            required: true,
          },
          {
            key: "singleSourceJustification",
            label: "Single-source justification",
            type: "longtext",
            placeholder: "Only required when quoteCount = 1",
          },
        ],
      },
      attachments: [
        {
          id: "att-quotes-on-activate",
          type: "NOTIFICATION",
          enabled: true,
          label: "Notify procurement channel",
          trigger: "ON_ACTIVATE",
          channel: "IN_APP",
          recipients: ["role:OPERATOR"],
          message: "New PR ready for sourcing: ${context.itemDescription}",
        },
        {
          id: "att-quotes-overdue",
          type: "NOTIFICATION",
          enabled: true,
          label: "Escalate if overdue",
          trigger: "ON_OVERDUE",
          channel: "IN_APP",
          recipients: ["role:PORTFOLIO_OWNER"],
          message:
            "Quotes for ${context.itemDescription} are overdue (target: 5 days).",
        },
      ],
    },
  },
  {
    id: "task_budget_check",
    type: "HUMAN_TASK",
    label: "Budget check",
    position: { x: 1280, y: 440 },
    config: {
      description:
        "Finance verifies the requesting cost center has remaining budget for this period.",
      assignment: { mode: "ROLE_BASED", role: "AUDITOR" },
      priority: "HIGH",
      slaMinutes: 8 * 60,
      formSchema: {
        fields: [
          {
            key: "budgetRemaining",
            label: "Remaining budget (USD)",
            type: "number",
            required: true,
          },
          {
            key: "fundsAvailable",
            label: "Funds available?",
            type: "boolean",
            required: true,
            defaultValue: "yes",
          },
          {
            key: "costCenter",
            label: "Cost center code",
            type: "text",
            required: true,
            placeholder: "CC-ENG-PLATFORM-01",
          },
          {
            key: "budgetNotes",
            label: "Notes",
            type: "longtext",
          },
        ],
      },
    },
  },
  {
    id: "join_sourcing",
    type: "PARALLEL_JOIN",
    label: "Quotes + budget ready",
    position: { x: 1520, y: 320 },
    config: {
      description: "Both sourcing tasks must complete before vendor selection.",
    },
  },

  // ── Vendor selection ────────────────────────────────────────────────────
  {
    id: "form_fill_vendor",
    type: "FORM_FILL",
    label: "Vendor selection & terms",
    position: { x: 1760, y: 320 },
    config: {
      description:
        "Procurement picks the vendor and captures the contract terms. The legal-review flag here decides whether the contract goes through legal.",
      assignment: { mode: "TEAM_QUEUE" },
      priority: "HIGH",
      slaMinutes: 2 * 24 * 60,
      formSchema: {
        fields: [
          {
            key: "chosenVendorName",
            label: "Chosen vendor",
            type: "text",
            required: true,
          },
          {
            key: "finalAmount",
            label: "Final negotiated amount (USD)",
            type: "number",
            required: true,
          },
          {
            key: "contractStartDate",
            label: "Contract start date",
            type: "date",
            required: true,
          },
          {
            key: "contractEndDate",
            label: "Contract end date",
            type: "date",
            helpText: "Leave blank for one-off purchases.",
          },
          {
            key: "paymentTerms",
            label: "Payment terms",
            type: "choice",
            required: true,
            defaultValue: "net30",
            options: [
              { value: "upfront", label: "Upfront" },
              { value: "net15", label: "Net 15" },
              { value: "net30", label: "Net 30" },
              { value: "net60", label: "Net 60" },
              { value: "net90", label: "Net 90" },
            ],
          },
          {
            key: "contractTerms",
            label: "Contract terms summary",
            type: "longtext",
            required: true,
            placeholder:
              "License count, term, auto-renew, termination clauses, SLAs, data residency…",
          },
          {
            key: "requiresLegalReview",
            label: "Requires legal review?",
            type: "boolean",
            defaultValue: "no",
            helpText:
              "Yes for any custom terms, MSA changes, data-processing addenda, or amounts > $25K.",
          },
          {
            key: "vendorContact",
            label: "Vendor contact (email)",
            type: "text",
            required: true,
            placeholder: "ar@vendor.com",
          },
        ],
      },
      outputBindings: [
        { name: "chosenVendorName", contextPath: "vendor.name" },
        { name: "finalAmount", contextPath: "vendor.amount" },
        { name: "paymentTerms", contextPath: "vendor.paymentTerms" },
        { name: "requiresLegalReview", contextPath: "vendor.requiresLegal" },
      ],
    },
  },

  // ── Optional legal review ───────────────────────────────────────────────
  {
    id: "gate_legal",
    type: "DECISION_GATE",
    label: "Legal review needed?",
    position: { x: 2000, y: 320 },
    config: {
      description: "Branches on vendor.requiresLegal.",
      defaultEdgeId: "edge_legal_default",
    },
  },
  {
    id: "approval_legal",
    type: "APPROVAL",
    label: "Legal review",
    position: { x: 2240, y: 200 },
    config: {
      description: "General Counsel reviews the contract terms.",
      assignment: { mode: "ROLE_BASED", role: "AUDITOR" },
      priority: "HIGH",
      slaMinutes: 3 * 24 * 60,
      allowedDecisionStatuses: [
        "APPROVED",
        "APPROVED_WITH_CONDITIONS",
        "REJECTED",
        "NEEDS_MORE_INFORMATION",
      ],
    },
  },

  // ── PO + fulfillment ────────────────────────────────────────────────────
  {
    id: "task_create_po",
    type: "HUMAN_TASK",
    label: "Create PO",
    position: { x: 2480, y: 320 },
    config: {
      description: "Procurement issues the purchase order in the ERP.",
      assignment: { mode: "TEAM_QUEUE" },
      priority: "HIGH",
      slaMinutes: 24 * 60,
      formSchema: {
        fields: [
          {
            key: "poNumber",
            label: "PO number",
            type: "text",
            required: true,
            placeholder: "PO-2026-00482",
          },
          {
            key: "poIssuedDate",
            label: "PO issued date",
            type: "date",
            required: true,
          },
          {
            key: "poUrl",
            label: "PO document URL",
            type: "text",
            placeholder: "https://erp.example.com/po/...",
          },
        ],
      },
      outputBindings: [{ name: "poNumber", contextPath: "po.number" }],
    },
  },
  {
    id: "notify_po_issued",
    type: "NOTIFICATION",
    label: "PO issued — notify all",
    position: { x: 2720, y: 320 },
    config: {
      description:
        "Email goes to the requester, the vendor contact, and the AP team.",
      notificationChannel: "EMAIL",
      notificationRecipients: [
        "role:OPERATOR",
        "role:AUDITOR",
      ],
    },
  },
  {
    id: "task_goods_receipt",
    type: "HUMAN_TASK",
    label: "Goods / service receipt",
    position: { x: 2960, y: 320 },
    config: {
      description:
        "Receiving team confirms goods arrived OR service was delivered.",
      assignment: { mode: "TEAM_QUEUE" },
      priority: "NORMAL",
      slaMinutes: 30 * 24 * 60,
      formSchema: {
        fields: [
          {
            key: "receivedDate",
            label: "Received date",
            type: "date",
            required: true,
          },
          {
            key: "quantityReceived",
            label: "Quantity received",
            type: "number",
            required: true,
          },
          {
            key: "matchesPo",
            label: "Matches PO exactly?",
            type: "boolean",
            required: true,
            defaultValue: "yes",
          },
          {
            key: "discrepancyNotes",
            label: "Discrepancy notes",
            type: "longtext",
            placeholder: "Required if matchesPo = no",
          },
        ],
      },
    },
  },
  {
    id: "task_invoice_match",
    type: "HUMAN_TASK",
    label: "Invoice match & pay",
    position: { x: 3200, y: 320 },
    config: {
      description:
        "AP team three-way-matches PO + receipt + invoice and authorizes payment.",
      assignment: { mode: "ROLE_BASED", role: "AUDITOR" },
      priority: "NORMAL",
      slaMinutes: 14 * 24 * 60,
      formSchema: {
        fields: [
          {
            key: "invoiceNumber",
            label: "Invoice number",
            type: "text",
            required: true,
          },
          {
            key: "invoiceAmount",
            label: "Invoice amount (USD)",
            type: "number",
            required: true,
          },
          {
            key: "invoiceDate",
            label: "Invoice date",
            type: "date",
            required: true,
          },
          {
            key: "threeWayMatch",
            label: "Three-way match successful?",
            type: "boolean",
            required: true,
            defaultValue: "yes",
          },
          {
            key: "paymentDate",
            label: "Payment date",
            type: "date",
            required: true,
          },
          {
            key: "paymentMethod",
            label: "Payment method",
            type: "choice",
            required: true,
            options: [
              { value: "ach", label: "ACH" },
              { value: "wire", label: "Wire" },
              { value: "check", label: "Check" },
              { value: "card", label: "Corporate card" },
            ],
          },
        ],
      },
    },
  },

  // ── Terminal nodes ──────────────────────────────────────────────────────
  {
    id: "end_done",
    type: "END",
    label: "Closed — paid",
    position: { x: 3440, y: 320 },
    config: { description: "Happy path. PO closed, payment cleared." },
  },
  {
    id: "end_rejected",
    type: "END",
    label: "Cancelled",
    position: { x: 800, y: 760 },
    config: {
      description:
        "Any approver (L1, L2, L3, Legal) rejected. Instance closes — no PO issued.",
    },
  },
];

const buildProcurementEdges = (): BusinessEdge[] => [
  // Intake → justification → routing
  {
    id: "edge_start_justify",
    sourceNodeId: "start",
    targetNodeId: "form_fill_justify",
  },
  {
    id: "edge_justify_gate",
    sourceNodeId: "form_fill_justify",
    targetNodeId: "gate_amount",
  },

  // Three-tier amount routing.
  // L1: amount < 5000 AND not capex
  {
    id: "edge_amount_l1",
    sourceNodeId: "gate_amount",
    targetNodeId: "approval_l1",
    label: "< $5K",
    condition: {
      logic: "AND",
      clauses: [
        { left: "amount", op: "lt", right: "5000" },
        { left: "isCapex", op: "neq", right: "yes" },
      ],
    },
  },
  // L2: $5K–$50K AND not capex
  {
    id: "edge_amount_l2",
    sourceNodeId: "gate_amount",
    targetNodeId: "approval_l2",
    label: "$5K – $50K",
    condition: {
      logic: "AND",
      clauses: [
        { left: "amount", op: "gte", right: "5000" },
        { left: "amount", op: "lt", right: "50000" },
        { left: "isCapex", op: "neq", right: "yes" },
      ],
    },
  },
  // L3 default — > $50K OR any capex
  {
    id: "edge_amount_l3",
    sourceNodeId: "gate_amount",
    targetNodeId: "approval_l3",
    label: "> $50K or capex",
  },

  // Each approval has approved → fork, rejected → end_rejected.
  {
    id: "edge_l1_approved",
    sourceNodeId: "approval_l1",
    targetNodeId: "fork_sourcing",
    label: "approved",
    condition: {
      logic: "OR",
      clauses: [
        { left: "decision", op: "eq", right: "APPROVED" },
        { left: "decision", op: "eq", right: "APPROVED_WITH_CONDITIONS" },
      ],
    },
  },
  {
    id: "edge_l1_rejected",
    sourceNodeId: "approval_l1",
    targetNodeId: "end_rejected",
    label: "rejected",
    condition: {
      logic: "AND",
      clauses: [{ left: "decision", op: "eq", right: "REJECTED" }],
    },
  },
  {
    id: "edge_l2_approved",
    sourceNodeId: "approval_l2",
    targetNodeId: "fork_sourcing",
    label: "approved",
    condition: {
      logic: "OR",
      clauses: [
        { left: "decision", op: "eq", right: "APPROVED" },
        { left: "decision", op: "eq", right: "APPROVED_WITH_CONDITIONS" },
      ],
    },
  },
  {
    id: "edge_l2_rejected",
    sourceNodeId: "approval_l2",
    targetNodeId: "end_rejected",
    label: "rejected",
    condition: {
      logic: "AND",
      clauses: [{ left: "decision", op: "eq", right: "REJECTED" }],
    },
  },
  {
    id: "edge_l3_approved",
    sourceNodeId: "approval_l3",
    targetNodeId: "fork_sourcing",
    label: "approved",
    condition: {
      logic: "OR",
      clauses: [
        { left: "decision", op: "eq", right: "APPROVED" },
        { left: "decision", op: "eq", right: "APPROVED_WITH_CONDITIONS" },
      ],
    },
  },
  {
    id: "edge_l3_rejected",
    sourceNodeId: "approval_l3",
    targetNodeId: "end_rejected",
    label: "rejected",
    condition: {
      logic: "AND",
      clauses: [{ left: "decision", op: "eq", right: "REJECTED" }],
    },
  },

  // Sourcing fork
  {
    id: "edge_fork_quotes",
    sourceNodeId: "fork_sourcing",
    targetNodeId: "task_get_quotes",
  },
  {
    id: "edge_fork_budget",
    sourceNodeId: "fork_sourcing",
    targetNodeId: "task_budget_check",
  },
  {
    id: "edge_quotes_join",
    sourceNodeId: "task_get_quotes",
    targetNodeId: "join_sourcing",
  },
  {
    id: "edge_budget_join",
    sourceNodeId: "task_budget_check",
    targetNodeId: "join_sourcing",
  },
  {
    id: "edge_join_vendor",
    sourceNodeId: "join_sourcing",
    targetNodeId: "form_fill_vendor",
  },

  // Vendor selection → legal gate
  {
    id: "edge_vendor_gate",
    sourceNodeId: "form_fill_vendor",
    targetNodeId: "gate_legal",
  },
  // Gate → legal review when flagged
  {
    id: "edge_legal_required",
    sourceNodeId: "gate_legal",
    targetNodeId: "approval_legal",
    label: "legal review required",
    condition: {
      logic: "OR",
      clauses: [
        { left: "vendor.requiresLegal", op: "eq", right: "yes" },
        { left: "requiresLegalReview", op: "eq", right: "yes" },
      ],
    },
  },
  // Gate default → straight to PO creation
  {
    id: "edge_legal_default",
    sourceNodeId: "gate_legal",
    targetNodeId: "task_create_po",
    label: "default",
  },
  // Legal approved → PO; rejected → end
  {
    id: "edge_legal_approved",
    sourceNodeId: "approval_legal",
    targetNodeId: "task_create_po",
    label: "approved",
    condition: {
      logic: "OR",
      clauses: [
        { left: "decision", op: "eq", right: "APPROVED" },
        { left: "decision", op: "eq", right: "APPROVED_WITH_CONDITIONS" },
      ],
    },
  },
  {
    id: "edge_legal_rejected",
    sourceNodeId: "approval_legal",
    targetNodeId: "end_rejected",
    label: "rejected",
    condition: {
      logic: "AND",
      clauses: [{ left: "decision", op: "eq", right: "REJECTED" }],
    },
  },

  // Fulfillment chain
  {
    id: "edge_po_notify",
    sourceNodeId: "task_create_po",
    targetNodeId: "notify_po_issued",
  },
  {
    id: "edge_notify_receipt",
    sourceNodeId: "notify_po_issued",
    targetNodeId: "task_goods_receipt",
  },
  {
    id: "edge_receipt_invoice",
    sourceNodeId: "task_goods_receipt",
    targetNodeId: "task_invoice_match",
  },
  {
    id: "edge_invoice_end",
    sourceNodeId: "task_invoice_match",
    targetNodeId: "end_done",
  },
];

const procurementDefinition = (): DemoTemplateDefinition => ({
  id: PROCUREMENT_TEMPLATE_ID,
  name: "Purchase request (procurement demo)",
  description:
    "End-to-end Purchase Request: 19 nodes, 25 edges, three-tier approval routing by amount, parallel sourcing (quotes + budget check), conditional legal review, full PO lifecycle through goods receipt and AP. Form schemas exercise every field type (short / long text, number, date, yes-no, choice). Ideal for demoing the runtime against operations / finance / procurement audiences.",
  metadata: {
    tags: ["demo", "procurement", "purchase-request", "approvals"],
    origin: "seed",
    complexity: "advanced",
  },
  nodes: buildProcurementNodes(),
  edges: buildProcurementEdges(),
  phases: [
    { id: "phase_intake", name: "Intake", displayOrder: 0, color: "#38bdf8" },
    { id: "phase_approve", name: "Approval", displayOrder: 1, color: "#a78bfa" },
    { id: "phase_source", name: "Sourcing", displayOrder: 2, color: "#22c55e" },
    { id: "phase_contract", name: "Contract", displayOrder: 3, color: "#f59e0b" },
    {
      id: "phase_fulfill",
      name: "Fulfillment",
      displayOrder: 4,
      color: "#06b6d4",
    },
    { id: "phase_close", name: "Close", displayOrder: 5, color: "#64748b" },
  ],
});

// ════════════════════════════════════════════════════════════════════════════
// Public entry point
// ════════════════════════════════════════════════════════════════════════════

/**
 * Idempotent insert. Re-runs of the seed are safe: stable template
 * ids + INSERT … ON CONFLICT DO NOTHING on both the templates row
 * and the version row. Called from inside `initializeSeedData`'s
 * transaction so we share the same client + commit fate.
 */
export const seedDemoBusinessWorkflowsTx = async (
  client: PoolClient,
  capabilityIds: readonly string[],
  publishedBy: string = "system:seed",
): Promise<void> => {
  if (capabilityIds.length === 0) return;
  const definitions = [onboardingDefinition(), procurementDefinition()];
  for (const capabilityId of capabilityIds) {
    for (const def of definitions) {
      await insertDemoTemplateTx(client, capabilityId, def, publishedBy);
    }
  }
};
