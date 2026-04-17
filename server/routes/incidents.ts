import { randomUUID } from 'node:crypto';
import type express from 'express';
import type {
  ActorContext,
  ApprovalAssignment,
  ApprovalDecision,
  ApprovalPolicy,
  CapabilityIncident,
  IncidentCorrelation,
  IncidentExportTarget,
  IncidentPacketLink,
} from '../../src/types';
import { sendApiError } from '../api/errors';
import {
  assertCapabilityPermission,
  assertWorkspacePermission,
  getWorkspaceAccessSnapshot,
} from '../access';
import { createApprovalAssignments, createApprovalDecision } from '../execution/repository';
import { getEvidencePacket } from '../evidencePackets';
import {
  normalizeManualIncidentInput,
  validateIncidentSourceRequest,
} from '../incidents/ingestion';
import {
  correlateIncident,
} from '../incidents/correlation';
import { renderIncidentPostmortemMarkdown, renderIncidentAlibiMarkdown } from '../incidents/attribution';
import {
  buildModelRiskMonitoringSummary,
  renderModelRiskMonitoringMarkdown,
} from '../incidents/mrm';
import {
  createIncident,
  createIncidentGuardrailPromotion,
  deleteIncidentPacketLink,
  createIncidentExportDelivery,
  deleteIncidentServiceCapabilityMap,
  deleteIncidentSourceConfig,
  getIncidentDetail,
  getIncidentExportTargetConfig,
  getIncidentLinksForPacket,
  getIncidentSourceConfig,
  linkPacketToIncident,
  listIncidentExportDeliveries,
  listIncidentExportTargetConfigs,
  listIncidentServiceCapabilityMaps,
  listIncidentSourceConfigs,
  listIncidents,
  upsertIncidentExportTargetConfig,
  upsertIncidentServiceCapabilityMap,
  upsertIncidentSourceConfig,
  queueIncidentJob,
} from '../incidents/repository';
import { wakeIncidentWorker } from '../incidents/worker';
import { queueIncidentDerivedLearningRefresh } from '../agentLearning/service';
import { buildIncidentIoIncidentFromWebhook } from '../incidents/webhooks/incidentIo';
import { buildPagerDutyIncidentFromWebhook, PAGERDUTY_SIGNATURE_HEADER } from '../incidents/webhooks/pagerduty';
import { buildServiceNowIncidentFromWebhook, SERVICENOW_SIGNATURE_HEADER } from '../incidents/webhooks/servicenow';

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const rateLimitBuckets = new Map<string, { windowStartedAt: number; count: number }>();
const exportTargets = new Set<IncidentExportTarget>(['datadog', 'servicenow']);

const readSecretReference = (secretReference?: string) => {
  const key = String(secretReference || '').trim();
  return key ? process.env[key] || '' : '';
};

const assertIncidentCommander = async (actor?: ActorContext | null) => {
  const snapshot = await getWorkspaceAccessSnapshot(actor);
  const roles = new Set(snapshot.currentActorPermissions.workspaceRoles || []);
  if (!roles.has('INCIDENT_COMMANDER') && !roles.has('WORKSPACE_ADMIN')) {
    throw new Error('Only an incident commander can confirm incident contributors or promote guardrails.');
  }
};

const enforceSourceRateLimit = ({
  source,
  limitPerMinute,
}: {
  source: string;
  limitPerMinute: number;
}) => {
  const now = Date.now();
  const current = rateLimitBuckets.get(source);
  if (!current || now - current.windowStartedAt >= 60_000) {
    rateLimitBuckets.set(source, { windowStartedAt: now, count: 1 });
    return;
  }
  if (current.count >= limitPerMinute) {
    throw new Error(`Rate limit exceeded for ${source} incident webhooks.`);
  }
  current.count += 1;
  rateLimitBuckets.set(source, current);
};

const createIncidentCorrelationResponse = async (incidentId: string) => {
  const detail = await getIncidentDetail(incidentId);
  if (!detail) {
    throw new Error(`Incident ${incidentId} was not found.`);
  }
  return detail;
};

const parseExportTarget = (value: string): IncidentExportTarget => {
  const target = String(value || '').trim().toLowerCase() as IncidentExportTarget;
  if (!exportTargets.has(target)) {
    throw new Error(`Unsupported export target "${value}".`);
  }
  return target;
};

const createPromotionAssignments = ({
  capabilityId,
  incidentId,
  packetBundleId,
  actor,
}: {
  capabilityId: string;
  incidentId: string;
  packetBundleId: string;
  actor: ActorContext;
}): Promise<{
  approvalPolicy: ApprovalPolicy;
  assignments: ApprovalAssignment[];
  syntheticRunId: string;
  syntheticWaitId: string;
}> => {
  const syntheticRunId = `INCIDENT-${incidentId}`;
  const syntheticWaitId = `WAIT-INCIDENT-GUARDRAIL-${incidentId}-${packetBundleId}`;
  return getWorkspaceAccessSnapshot(actor).then(snapshot => {
    const approverUsers = snapshot.organization.users.filter(user =>
      user.workspaceRoles.includes('INCIDENT_COMMANDER') ||
      user.workspaceRoles.includes('WORKSPACE_ADMIN'),
    );
    if (approverUsers.length === 0) {
      throw new Error('No incident commander or workspace admin is available to approve this guardrail promotion.');
    }

    const approvalPolicy: ApprovalPolicy = {
      id: `POLICY-${incidentId}-${packetBundleId}`,
      name: 'Incident-derived guardrail promotion',
      description: 'Requires human approval before reviewer concerns are promoted into hard guardrails.',
      mode: 'ALL_REQUIRED',
      targets: approverUsers.map(user => ({
        targetType: 'USER',
        targetId: user.id,
        label: user.name,
      })),
      minimumApprovals: approverUsers.length,
      delegationAllowed: false,
    };

    return {
      approvalPolicy,
      syntheticRunId,
      syntheticWaitId,
      assignments: approverUsers.map(user => ({
        id: createId('APPROVAL'),
        capabilityId,
        runId: syntheticRunId,
        waitId: syntheticWaitId,
        phase: undefined,
        stepName: 'Incident-derived guardrail promotion',
        approvalPolicyId: approvalPolicy.id,
        status: 'PENDING',
        targetType: 'USER',
        targetId: user.id,
        assignedUserId: user.id,
        assignedTeamId: user.teamIds[0],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };
  });
};

const maybeTriggerIncidentLearning = async ({
  incident,
  packetBundleId,
}: {
  incident: CapabilityIncident;
  packetBundleId: string;
}) => {
  const packet = await getEvidencePacket(packetBundleId);
  if (!packet) {
    return;
  }
  const agentIds = Array.from(
    new Set(
      (packet.payload.runDetail?.steps || [])
        .map(step => step.agentId)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ),
  );
  if (!agentIds.length) {
    return;
  }

  await Promise.all(
    agentIds.map(agentId =>
      queueIncidentDerivedLearningRefresh({
        capabilityId: packet.capabilityId,
        agentId,
        incident,
        packetBundleId,
        workItemId: packet.workItemId,
        runId: packet.runId,
      }),
    ),
  );
};

const handleWebhook = async ({
  request,
  response,
  source,
  signatureHeader,
  builder,
}: {
  request: express.Request;
  response: express.Response;
  source: 'pagerduty' | 'servicenow' | 'incident-io';
  signatureHeader: string;
  builder: (args: {
    payload: Record<string, any>;
    actorUserId?: string;
  }) => Promise<CapabilityIncident>;
}) => {
  try {
    const config = await getIncidentSourceConfig(source);
    if (!config) {
      response.status(404).json({ error: `${source} incident source is not configured.` });
      return;
    }

    const rawBody = String((request as any).rawBody || JSON.stringify(request.body || {}));
    enforceSourceRateLimit({
      source,
      limitPerMinute: config.rateLimitPerMinute || 60,
    });
    validateIncidentSourceRequest({
      config,
      rawBody,
      signature: request.header(signatureHeader),
      authorization: request.header('authorization') || undefined,
      resolvedSecret: readSecretReference(config.secretReference),
    });

    const incident = await builder({
      payload: request.body as Record<string, any>,
      actorUserId: undefined,
    });
    const saved = await createIncident(incident);
    await queueIncidentJob({
      id: `INCJOB-${randomUUID().slice(0, 12).toUpperCase()}`,
      source,
      incidentId: saved.id,
      type: 'CORRELATE',
      status: 'QUEUED',
      payload: {},
      attempts: 0,
      availableAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    wakeIncidentWorker();
    response.json({ status: 'accepted', incidentId: saved.id });
  } catch (error) {
    sendApiError(response, error);
  }
};

export const registerIncidentRoutes = (
  app: express.Express,
  {
    parseActorContext,
  }: {
    parseActorContext: (request: express.Request, fallbackDisplayName: string) => ActorContext;
  },
) => {
  app.get('/api/incidents', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const capabilityId = String(request.query.capabilityId || '').trim() || undefined;
      const severity = String(request.query.severity || '').trim() || undefined;
      const status = String(request.query.status || '').trim() || undefined;

      if (capabilityId) {
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.read',
        });
      } else {
        await assertWorkspacePermission({ actor, action: 'report.view.operations' });
      }

      response.json(await listIncidents({ capabilityId, severity, status }));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/incidents', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const incident = await normalizeManualIncidentInput({
        source: 'manual',
        payload: request.body as Record<string, any>,
        actorUserId: actor.userId,
      });
      if (!incident.capabilityId) {
        response.status(400).json({ error: 'A capability is required when creating a manual incident.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: incident.capabilityId,
        actor,
        action: 'capability.edit',
      });

      const saved = await createIncident(incident);
      const initialPacketBundleId = String(request.body?.initialPacketBundleId || '').trim();
      if (initialPacketBundleId) {
        await linkPacketToIncident({
          incidentId: saved.id,
          packetBundleId: initialPacketBundleId,
          correlation: 'SUSPECTED',
          correlationReasons: ['Linked during incident creation.'],
          linkedAt: new Date().toISOString(),
          linkedBy: actor.userId,
          linkedByActorDisplayName: actor.displayName,
        });
      }
      response.status(201).json(await createIncidentCorrelationResponse(saved.id));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/incidents/:id', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const detail = await getIncidentDetail(request.params.id);
      if (!detail) {
        response.status(404).json({ error: 'Incident was not found.' });
        return;
      }
      if (detail.capabilityId) {
        await assertCapabilityPermission({
          capabilityId: detail.capabilityId,
          actor,
          action: 'capability.read',
        });
      } else {
        await assertWorkspacePermission({ actor, action: 'report.view.operations' });
      }
      response.json(detail);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/incidents/:id/links', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const incident = await getIncidentDetail(request.params.id);
      if (!incident?.capabilityId) {
        response.status(404).json({ error: 'Incident was not found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: incident.capabilityId,
        actor,
        action: 'capability.edit',
      });
      const packetBundleId = String(request.body?.packetBundleId || '').trim();
      if (!packetBundleId) {
        response.status(400).json({ error: 'A packet bundle id is required.' });
        return;
      }
      const correlation = (String(request.body?.correlation || 'SUSPECTED').trim() ||
        'SUSPECTED') as IncidentCorrelation;
      if (correlation === 'CONFIRMED' || correlation === 'BLAST_RADIUS') {
        await assertIncidentCommander(actor);
      }
      const link = await linkPacketToIncident({
        incidentId: incident.id,
        packetBundleId,
        correlation,
        correlationScore:
          request.body?.correlationScore === undefined
            ? undefined
            : Number(request.body.correlationScore),
        correlationReasons: Array.isArray(request.body?.correlationReasons)
          ? request.body.correlationReasons.map(String)
          : [],
        linkedAt: new Date().toISOString(),
        linkedBy: actor.userId,
        linkedByActorDisplayName: actor.displayName,
      });
      if (link.correlation === 'CONFIRMED') {
        await maybeTriggerIncidentLearning({
          incident,
          packetBundleId,
        });
      }
      response.status(201).json(link);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/incidents/:id/links/:bundleId', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const incident = await getIncidentDetail(request.params.id);
      if (!incident?.capabilityId) {
        response.status(404).json({ error: 'Incident was not found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: incident.capabilityId,
        actor,
        action: 'capability.edit',
      });
      const correlation = (String(request.body?.correlation || '').trim() ||
        'SUSPECTED') as IncidentCorrelation;
      if (correlation === 'CONFIRMED' || correlation === 'BLAST_RADIUS') {
        await assertIncidentCommander(actor);
      }
      const link = await linkPacketToIncident({
        incidentId: incident.id,
        packetBundleId: request.params.bundleId,
        correlation,
        correlationScore:
          request.body?.correlationScore === undefined
            ? undefined
            : Number(request.body.correlationScore),
        correlationReasons: Array.isArray(request.body?.correlationReasons)
          ? request.body.correlationReasons.map(String)
          : [],
        linkedAt: new Date().toISOString(),
        linkedBy: actor.userId,
        linkedByActorDisplayName: actor.displayName,
      });
      if (link.correlation === 'CONFIRMED') {
        await maybeTriggerIncidentLearning({
          incident,
          packetBundleId: request.params.bundleId,
        });
      }
      response.json(link);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.delete('/api/incidents/:id/links/:bundleId', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const incident = await getIncidentDetail(request.params.id);
      if (!incident?.capabilityId) {
        response.status(404).json({ error: 'Incident was not found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: incident.capabilityId,
        actor,
        action: 'capability.edit',
      });
      await deleteIncidentPacketLink({
        incidentId: request.params.id,
        packetBundleId: request.params.bundleId,
      });
      response.json({ status: 'deleted' });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/incidents/:id/correlate', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const incident = await getIncidentDetail(request.params.id);
      if (!incident?.capabilityId) {
        response.status(404).json({ error: 'Incident was not found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: incident.capabilityId,
        actor,
        action: 'capability.edit',
      });
      response.json(
        await correlateIncident({
          incidentId: incident.id,
          actorUserId: actor.userId,
          actorDisplayName: actor.displayName,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/incidents/:id/postmortem.md', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const incident = await getIncidentDetail(request.params.id);
      if (!incident?.capabilityId) {
        response.status(404).json({ error: 'Incident was not found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: incident.capabilityId,
        actor,
        action: 'capability.read',
      });
      response.type('text/markdown').send(await renderIncidentPostmortemMarkdown(incident));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/incidents/:id/alibi.md', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const incident = await getIncidentDetail(request.params.id);
      if (!incident?.capabilityId) {
        response.status(404).json({ error: 'Incident was not found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: incident.capabilityId,
        actor,
        action: 'capability.read',
      });
      response.type('text/markdown').send(await renderIncidentAlibiMarkdown(incident));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/incidents/packets/:bundleId/links', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const packet = await getEvidencePacket(request.params.bundleId);
      if (!packet) {
        response.status(404).json({ error: 'Evidence packet was not found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: packet.capabilityId,
        actor,
        action: 'artifact.read',
      });
      response.json(await getIncidentLinksForPacket(request.params.bundleId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/incidents/:id/links/:bundleId/promote-guardrail', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertIncidentCommander(actor);
      const incident = await getIncidentDetail(request.params.id);
      if (!incident?.capabilityId) {
        response.status(404).json({ error: 'Incident was not found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: incident.capabilityId,
        actor,
        action: 'capability.edit',
      });
      const concernText = String(request.body?.concernText || '').trim();
      if (!concernText) {
        response.status(400).json({ error: 'Concern text is required.' });
        return;
      }
      const { approvalPolicy, assignments, syntheticRunId, syntheticWaitId } =
        await createPromotionAssignments({
          capabilityId: incident.capabilityId,
          incidentId: incident.id,
          packetBundleId: request.params.bundleId,
          actor,
        });

      const promotion = await createIncidentGuardrailPromotion({
        id: createId('IGP'),
        capabilityId: incident.capabilityId,
        incidentId: incident.id,
        packetBundleId: request.params.bundleId,
        concernText,
        approvalPolicyId: approvalPolicy.id,
        approvalRunId: syntheticRunId,
        approvalWaitId: syntheticWaitId,
        requestedByActorUserId: actor.userId,
        requestedByActorDisplayName: actor.displayName,
      });

      await createApprovalAssignments(assignments);
      await createApprovalDecision({
        id: createId('APPDEC'),
        capabilityId: incident.capabilityId,
        runId: syntheticRunId,
        waitId: syntheticWaitId,
        disposition: 'REQUEST_CHANGES',
        actorUserId: actor.userId,
        actorDisplayName: actor.displayName,
        actorTeamIds: actor.teamIds,
        comment: `Guardrail promotion requested for incident ${incident.id}: ${concernText}`,
        createdAt: new Date().toISOString(),
      } satisfies ApprovalDecision);

      response.status(201).json({
        promotion,
        approvalPolicy,
        assignments,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/incidents/config/sources', async (request, response) => {
    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      response.json(await listIncidentSourceConfigs());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.put('/api/incidents/config/sources/:source', async (request, response) => {
    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      response.json(
        await upsertIncidentSourceConfig({
          source: request.params.source as any,
          enabled: Boolean(request.body?.enabled),
          authType: request.body?.authType || 'HMAC_SHA256',
          secretReference: String(request.body?.secretReference || '').trim() || undefined,
          basicUsername: String(request.body?.basicUsername || '').trim() || undefined,
          signatureHeader: String(request.body?.signatureHeader || '').trim() || undefined,
          rateLimitPerMinute: Number(request.body?.rateLimitPerMinute || 60),
          settings:
            request.body?.settings && typeof request.body.settings === 'object'
              ? request.body.settings
              : {},
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.delete('/api/incidents/config/sources/:source', async (request, response) => {
    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      await deleteIncidentSourceConfig(request.params.source as any);
      response.json({ status: 'deleted' });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/incidents/config/services', async (request, response) => {
    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      response.json(await listIncidentServiceCapabilityMaps());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.put('/api/incidents/config/services/:serviceName', async (request, response) => {
    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      response.json(
        await upsertIncidentServiceCapabilityMap({
          serviceName: request.params.serviceName,
          capabilityId: String(request.body?.capabilityId || '').trim(),
          defaultAffectedPaths: Array.isArray(request.body?.defaultAffectedPaths)
            ? request.body.defaultAffectedPaths.map(String)
            : [],
          ownerEmail: String(request.body?.ownerEmail || '').trim() || undefined,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.delete('/api/incidents/config/services/:serviceName', async (request, response) => {
    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      await deleteIncidentServiceCapabilityMap(request.params.serviceName);
      response.json({ status: 'deleted' });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/incidents/exports/targets', async (request, response) => {
    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      response.json(await listIncidentExportTargetConfigs());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.put('/api/incidents/exports/targets/:target', async (request, response) => {
    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      const target = parseExportTarget(request.params.target);
      response.json(
        await upsertIncidentExportTargetConfig({
          target,
          enabled: Boolean(request.body?.enabled),
          authType: request.body?.authType === 'BASIC' ? 'BASIC' : 'API_KEY',
          baseUrl: String(request.body?.baseUrl || '').trim() || undefined,
          secretReference: String(request.body?.secretReference || '').trim() || undefined,
          basicUsername: String(request.body?.basicUsername || '').trim() || undefined,
          settings:
            request.body?.settings && typeof request.body.settings === 'object'
              ? request.body.settings
              : {},
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/incidents/exports/deliveries', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const incidentId = String(request.query.incidentId || '').trim() || undefined;
      const capabilityId = String(request.query.capabilityId || '').trim() || undefined;
      const target = request.query.target ? parseExportTarget(String(request.query.target)) : undefined;
      const limit = Math.max(1, Math.min(100, Number(request.query.limit || 25)));

      if (incidentId) {
        const incident = await getIncidentDetail(incidentId);
        if (!incident?.capabilityId) {
          response.status(404).json({ error: 'Incident was not found.' });
          return;
        }
        await assertCapabilityPermission({
          capabilityId: incident.capabilityId,
          actor,
          action: 'capability.read',
        });
        response.json(await listIncidentExportDeliveries({ incidentId, target, limit }));
        return;
      }

      if (capabilityId) {
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.read',
        });
        response.json(await listIncidentExportDeliveries({ capabilityId, target, limit }));
        return;
      }

      await assertWorkspacePermission({ actor, action: 'report.view.audit' });
      response.json(await listIncidentExportDeliveries({ target, limit }));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/incidents/:id/export/:target', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const incident = await getIncidentDetail(request.params.id);
      if (!incident?.capabilityId) {
        response.status(404).json({ error: 'Incident was not found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: incident.capabilityId,
        actor,
        action: 'capability.edit',
      });
      const target = parseExportTarget(request.params.target);
      const config = await getIncidentExportTargetConfig(target);
      if (!config?.enabled) {
        response.status(400).json({ error: `${target} export is not configured.` });
        return;
      }

      const delivery = await createIncidentExportDelivery({
        id: createId('IEXP'),
        target,
        exportKind: 'INCIDENT',
        incidentId: incident.id,
        capabilityId: incident.capabilityId,
        status: 'QUEUED',
        requestPayload: {
          incidentId: incident.id,
          target,
          capabilityId: incident.capabilityId,
        },
        triggeredByActorUserId: actor.userId,
        triggeredByActorDisplayName: actor.displayName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await queueIncidentJob({
        id: `INCJOB-${randomUUID().slice(0, 12).toUpperCase()}`,
        source: incident.source,
        incidentId: incident.id,
        type: 'EXPORT_INCIDENT',
        status: 'QUEUED',
        payload: {
          target,
          deliveryId: delivery.id,
          actorUserId: actor.userId,
          actorDisplayName: actor.displayName,
        },
        attempts: 0,
        availableAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      wakeIncidentWorker();
      response.status(202).json(delivery);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/incidents/webhooks/pagerduty', async (request, response) =>
    handleWebhook({
      request,
      response,
      source: 'pagerduty',
      signatureHeader: PAGERDUTY_SIGNATURE_HEADER,
      builder: buildPagerDutyIncidentFromWebhook,
    }),
  );

  app.post('/api/incidents/webhooks/servicenow', async (request, response) =>
    handleWebhook({
      request,
      response,
      source: 'servicenow',
      signatureHeader: SERVICENOW_SIGNATURE_HEADER,
      builder: buildServiceNowIncidentFromWebhook,
    }),
  );

  app.post('/api/incidents/webhooks/incident-io', async (request, response) =>
    handleWebhook({
      request,
      response,
      source: 'incident-io',
      signatureHeader: 'x-incidentio-signature',
      builder: buildIncidentIoIncidentFromWebhook,
    }),
  );

  app.get('/api/mrm/summary', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const capabilityId = String(request.query.capabilityId || '').trim() || undefined;
      const windowDays = Math.max(1, Number(request.query.windowDays || 90));
      if (capabilityId) {
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.read',
        });
      } else {
        await assertWorkspacePermission({ actor, action: 'report.view.audit' });
      }
      response.json(await buildModelRiskMonitoringSummary({ capabilityId, windowDays }));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/mrm/export', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const capabilityId = String(request.query.capabilityId || '').trim() || undefined;
      const windowDays = Math.max(1, Number(request.query.windowDays || 90));
      const format = String(request.query.format || 'markdown').trim().toLowerCase();
      if (capabilityId) {
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.read',
        });
      } else {
        await assertWorkspacePermission({ actor, action: 'report.view.audit' });
      }

      if (format === 'json') {
        response.json(await buildModelRiskMonitoringSummary({ capabilityId, windowDays }));
        return;
      }

      response.type('text/markdown').send(
        await renderModelRiskMonitoringMarkdown({ capabilityId, windowDays }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/mrm/export/:target', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const target = parseExportTarget(request.params.target);
      const capabilityId = String(request.body?.capabilityId || request.query.capabilityId || '').trim() || undefined;
      const windowDays = Math.max(1, Number(request.body?.windowDays || request.query.windowDays || 90));

      if (capabilityId) {
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.edit',
        });
      } else {
        await assertWorkspacePermission({ actor, action: 'report.view.audit' });
      }

      const config = await getIncidentExportTargetConfig(target);
      if (!config?.enabled) {
        response.status(400).json({ error: `${target} export is not configured.` });
        return;
      }

      const delivery = await createIncidentExportDelivery({
        id: createId('IEXP'),
        target,
        exportKind: 'MRM',
        capabilityId,
        windowDays,
        status: 'QUEUED',
        requestPayload: {
          target,
          capabilityId,
          windowDays,
        },
        triggeredByActorUserId: actor.userId,
        triggeredByActorDisplayName: actor.displayName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await queueIncidentJob({
        id: `INCJOB-${randomUUID().slice(0, 12).toUpperCase()}`,
        source: 'manual',
        type: 'EXPORT_MRM',
        status: 'QUEUED',
        payload: {
          target,
          capabilityId,
          windowDays,
          deliveryId: delivery.id,
          actorUserId: actor.userId,
          actorDisplayName: actor.displayName,
        },
        attempts: 0,
        availableAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      wakeIncidentWorker();
      response.status(202).json(delivery);
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
