/**
 * Sentinel Mode — autonomous security incident remediation.
 *
 * When a security scanner (SonarQube, Snyk, GitHub Advanced Security,
 * manual trigger) posts an alert, this route:
 *   1. Validates the payload.
 *   2. Creates a work item tagged SENTINEL with a pre-populated
 *      description referencing the CVE / finding.
 *   3. Immediately triggers workflow execution so the agent pipeline
 *      starts remediating without human kick-off.
 *   4. Returns a mission ID and status so the caller can poll or
 *      link directly to the Sentinel dashboard.
 *
 * Human-in-the-loop is preserved: the execution engine will reach a
 * WAITING_APPROVAL wait before merging any patch, surfacing a
 * "Review Release Passport → Approve & Deploy" prompt to the owner.
 */
import { randomUUID } from 'node:crypto';
import type express from 'express';
import { assertCapabilityPermission, assertWorkspacePermission } from '../access';
import { sendApiError } from '../api/errors';
import { parseActorContext } from '../requestActor';
import { createWorkItemRecord, startWorkflowExecution } from '../execution/service';
import { query } from '../db';
import type { WorkItem } from '../../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// Public types (shared with frontend)
// ─────────────────────────────────────────────────────────────────────────────

export type SentinelAlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface SentinelAlertPayload {
  /** The CVE identifier or scanner-native finding ID. */
  cveId: string;
  /** Human-readable description of the vulnerability. */
  description: string;
  severity: SentinelAlertSeverity;
  /** Affected source file path relative to repo root (optional). */
  affectedFile?: string;
  /** The scanner that produced this alert. */
  source?: 'sonarqube' | 'snyk' | 'github-security' | 'manual';
  /**
   * The capability ID to remediate.  If omitted, the first capability
   * in the workspace is chosen (useful for single-capability workspaces).
   */
  capabilityId?: string;
  /**
   * The workflow ID to use for remediation.  If omitted, the first
   * active workflow in the capability is used.
   */
  workflowId?: string;
}

export interface SentinelMissionStatus {
  missionId: string;
  workItemId: string;
  capabilityId: string;
  cveId: string;
  severity: SentinelAlertSeverity;
  description: string;
  status: WorkItem['status'] | 'DISPATCHED';
  createdAt: string;
  runId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const severityPriority: Record<SentinelAlertSeverity, WorkItem['priority']> = {
  CRITICAL: 'High',
  HIGH: 'High',
  MEDIUM: 'Med',
  LOW: 'Low',
};

/** Resolves the first workflow ID from a capability bundle if none supplied. */
const resolveWorkflowId = async (
  capabilityId: string,
  hint?: string,
): Promise<string | null> => {
  if (hint) return hint;
  const result = await query<Record<string, unknown>>(
    `
      SELECT id FROM capability_workflows
      WHERE capability_id = $1
        AND status = 'PUBLISHED'
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [capabilityId],
  );
  return result.rows[0] ? String(result.rows[0]['id']) : null;
};

/** Resolves the first capability ID if none supplied. */
const resolveCapabilityId = async (hint?: string): Promise<string | null> => {
  if (hint) return hint;
  const result = await query<Record<string, unknown>>(
    `SELECT id FROM capabilities ORDER BY created_at ASC LIMIT 1`,
    [],
  );
  return result.rows[0] ? String(result.rows[0]['id']) : null;
};

/** Build the work-item description from the alert payload. */
const buildWorkItemDescription = (alert: SentinelAlertPayload): string => {
  const lines = [
    `**Sentinel Mode — Autonomous Security Remediation**`,
    ``,
    `**Finding:** ${alert.cveId}`,
    `**Severity:** ${alert.severity}`,
    `**Source:** ${alert.source ?? 'manual'}`,
    ``,
    `**Description:** ${alert.description}`,
  ];
  if (alert.affectedFile) {
    lines.push(``, `**Affected File:** \`${alert.affectedFile}\``);
  }
  lines.push(
    ``,
    `---`,
    `This work item was automatically created by Sentinel Mode.`,
    `The agent will: (1) locate the vulnerable symbol, (2) apply a targeted fix, `,
    `(3) run the test suite, (4) generate a Release Passport, and (5) await your approval.`,
  );
  return lines.join('\n');
};

// ─────────────────────────────────────────────────────────────────────────────
// Route registration
// ─────────────────────────────────────────────────────────────────────────────

type SentinelRouteDeps = {
  parseActor: (value: unknown, fallback: string) => string;
};

export const registerSentinelRoutes = (
  app: express.Express,
  { parseActor }: SentinelRouteDeps,
) => {
  /**
   * POST /api/sentinel/alert
   *
   * Receives a security alert and autonomously creates + triggers a
   * remediation work item. Responds 202 Accepted immediately.
   */
  app.post('/api/sentinel/alert', async (request, response) => {
    try {
      const actor = parseActorContext(
        request,
        parseActor(request.body?.guidedBy, 'Sentinel'),
      );

      const body = request.body as Partial<SentinelAlertPayload>;
      const cveId = String(body.cveId ?? '').trim();
      const description = String(body.description ?? '').trim();
      const severity: SentinelAlertSeverity =
        (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).find(
          s => s === String(body.severity ?? '').toUpperCase(),
        ) ?? 'HIGH';

      if (!cveId || !description) {
        response.status(400).json({ error: '`cveId` and `description` are required.' });
        return;
      }

      const capabilityId = await resolveCapabilityId(body.capabilityId);
      if (!capabilityId) {
        response.status(422).json({ error: 'No capability found. Supply capabilityId.' });
        return;
      }

      await assertCapabilityPermission({
        capabilityId,
        actor,
        action: 'workitem.create',
      });

      const workflowId = await resolveWorkflowId(capabilityId, body.workflowId);
      if (!workflowId) {
        response.status(422).json({
          error: 'No published workflow found for this capability. Supply workflowId.',
        });
        return;
      }

      const alert: SentinelAlertPayload = {
        cveId,
        description,
        severity,
        affectedFile: body.affectedFile ? String(body.affectedFile) : undefined,
        source: body.source ?? 'manual',
        capabilityId,
        workflowId,
      };

      // Create the work item.
      const workItem = await createWorkItemRecord({
        capabilityId,
        title: `[SENTINEL] ${cveId}: ${description.slice(0, 80)}${description.length > 80 ? '…' : ''}`,
        description: buildWorkItemDescription(alert),
        workflowId,
        taskType: 'SECURITY' as WorkItem['taskType'],
        priority: severityPriority[severity],
        tags: ['sentinel', 'security', severity.toLowerCase(), cveId],
        actor,
      });

      // Fire-and-forget: start execution (will reach WAITING_APPROVAL before merge).
      startWorkflowExecution({
        capabilityId,
        workItemId: workItem.id,
        guidance: [
          `SENTINEL MISSION: Remediate ${cveId}.`,
          alert.affectedFile
            ? `The vulnerable code is in \`${alert.affectedFile}\`. Locate the exact symbol, apply a minimal targeted fix, run tests, and generate a Release Passport before awaiting approval.`
            : `Locate the vulnerable code matching "${description}", apply a minimal targeted fix, run tests, and generate a Release Passport before awaiting approval.`,
          `Do NOT merge to main directly. Stop at the WAITING_APPROVAL step and surface the Release Passport link.`,
        ].join('\n'),
        guidedBy: actor.userId ?? 'Sentinel',
        actor,
      }).catch(err => {
        // Non-fatal — the work item is created; execution can be
        // triggered manually from the Sentinel dashboard.
        console.warn(`[sentinel] failed to auto-start execution for ${workItem.id}:`, err);
      });

      const missionStatus: SentinelMissionStatus = {
        missionId: randomUUID(),
        workItemId: workItem.id,
        capabilityId,
        cveId,
        severity,
        description,
        status: 'DISPATCHED',
        createdAt: new Date().toISOString(),
      };

      response.status(202).json(missionStatus);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  /**
   * GET /api/sentinel/missions
   *
   * Lists work items created by Sentinel Mode (tagged 'sentinel').
   * Optionally filtered by capabilityId.
   */
  app.get('/api/sentinel/missions', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });

      const capabilityId = request.query.capabilityId
        ? String(request.query.capabilityId)
        : null;

      const result = await query<Record<string, unknown>>(
        capabilityId
          ? `
              SELECT
                wi.id AS work_item_id,
                wi.capability_id,
                wi.title,
                wi.status,
                wi.priority,
                wi.tags,
                wi.created_at,
                wi.description,
                r.id AS run_id
              FROM capability_work_items wi
              LEFT JOIN LATERAL (
                SELECT id FROM capability_workflow_runs
                WHERE capability_id = wi.capability_id AND work_item_id = wi.id
                ORDER BY created_at DESC LIMIT 1
              ) r ON true
              WHERE wi.capability_id = $1
                AND $2 = ANY(wi.tags)
              ORDER BY wi.created_at DESC
              LIMIT 50
            `
          : `
              SELECT
                wi.id AS work_item_id,
                wi.capability_id,
                wi.title,
                wi.status,
                wi.priority,
                wi.tags,
                wi.created_at,
                wi.description,
                r.id AS run_id
              FROM capability_work_items wi
              LEFT JOIN LATERAL (
                SELECT id FROM capability_workflow_runs
                WHERE capability_id = wi.capability_id AND work_item_id = wi.id
                ORDER BY created_at DESC LIMIT 1
              ) r ON true
              WHERE $1 = ANY(wi.tags)
              ORDER BY wi.created_at DESC
              LIMIT 50
            `,
        capabilityId ? [capabilityId, 'sentinel'] : ['sentinel'],
      );

      const missions: SentinelMissionStatus[] = result.rows.map(row => {
        const tags: string[] = (row['tags'] as string[]) || [];
        const cveTag = tags.find(t => t.toUpperCase().startsWith('CVE-')) ?? '';
        const severityTag = (
          tags.find(t => ['critical', 'high', 'medium', 'low'].includes(t.toLowerCase())) ?? 'high'
        ).toUpperCase() as SentinelAlertSeverity;

        return {
          missionId: String(row['work_item_id']),
          workItemId: String(row['work_item_id']),
          capabilityId: String(row['capability_id']),
          cveId: cveTag || String(row['title']).replace('[SENTINEL] ', '').split(':')[0],
          severity: severityTag,
          description: String(row['description'] ?? row['title'] ?? '').slice(0, 200),
          status: row['status'] as WorkItem['status'],
          createdAt: String(row['created_at']),
          runId: row['run_id'] ? String(row['run_id']) : undefined,
        };
      });

      response.json(missions);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  /**
   * POST /api/sentinel/alert/sonarqube
   *
   * Accepts the SonarQube webhook payload format and normalises it
   * into the standard sentinel alert before dispatching.
   */
  app.post('/api/sentinel/alert/sonarqube', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Sentinel (SonarQube)');
      const body = request.body as Record<string, any>;

      // SonarQube webhook payload shape:
      //   { project: { key }, qualityGate: { status }, issues: [{ rule, message, severity, component }] }
      const issues: any[] = body?.issues ?? [];
      const critical = issues.filter(
        (i: any) => i.severity === 'CRITICAL' || i.severity === 'BLOCKER',
      );
      const target = critical[0] ?? issues[0];

      if (!target) {
        response.status(422).json({ error: 'No issues found in SonarQube payload.' });
        return;
      }

      const cveId = String(target.rule ?? 'SONAR-FINDING');
      const description = String(target.message ?? target.component ?? 'SonarQube finding');
      const affectedFile = target.component
        ? String(target.component).split(':').pop()
        : undefined;
      const severity: SentinelAlertSeverity =
        target.severity === 'BLOCKER' || target.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH';

      // Re-dispatch to the standard alert handler by forwarding to ourselves.
      request.body = {
        cveId,
        description,
        severity,
        affectedFile,
        source: 'sonarqube',
        capabilityId: request.query.capabilityId ? String(request.query.capabilityId) : undefined,
      } satisfies SentinelAlertPayload;

      // Internal redirect: call the alert handler directly.
      const capabilityId = await resolveCapabilityId(
        request.query.capabilityId ? String(request.query.capabilityId) : undefined,
      );
      if (!capabilityId) {
        response.status(422).json({ error: 'No capability found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId,
        actor,
        action: 'workitem.create',
      });
      const workflowId = await resolveWorkflowId(capabilityId);
      if (!workflowId) {
        response.status(422).json({ error: 'No published workflow found.' });
        return;
      }
      const workItem = await createWorkItemRecord({
        capabilityId,
        title: `[SENTINEL] ${cveId}: ${description.slice(0, 80)}`,
        description: buildWorkItemDescription({
          cveId,
          description,
          severity,
          affectedFile,
          source: 'sonarqube',
          capabilityId,
          workflowId,
        }),
        workflowId,
        taskType: 'SECURITY' as WorkItem['taskType'],
        priority: severityPriority[severity],
        tags: ['sentinel', 'security', severity.toLowerCase(), cveId, 'sonarqube'],
        actor,
      });
      startWorkflowExecution({
        capabilityId,
        workItemId: workItem.id,
        guidance: `SENTINEL MISSION (SonarQube): Remediate ${cveId}. Affected: ${affectedFile ?? 'unknown'}. Apply a minimal fix, run tests, await approval.`,
        guidedBy: actor.userId ?? 'Sentinel',
        actor,
      }).catch(console.warn);

      response.status(202).json({ missionId: workItem.id, workItemId: workItem.id });
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
