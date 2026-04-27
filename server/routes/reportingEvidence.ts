import type express from 'express';
import type { ReportExportPayload } from '../../src/types';
import { assertCapabilityPermission, assertWorkspacePermission } from '../access';
import { sendApiError } from '../api/errors';
import {
  activateAgentLearningProfileVersionWithAudit,
  applyAgentLearningCorrection,
  getAgentLearningDriftState,
  getAgentLearningProfileDetail,
  getAgentLearningProfileVersionDiff,
  getAgentLearningProfileVersionHistory,
  queueSingleAgentLearningRefresh,
} from '../agentLearning/service';
import { getAgentMindSnapshot } from '../agentMind';
import { distillAgentChatSession } from '../agentLearning/chatDistillation';
import { wakeAgentLearningWorker } from '../agentLearning/worker';
import {
  createEvidencePacketForWorkItem,
  formatEvidencePacketForDisplay,
  getAttestationChain,
  getEvidencePacket,
  verifyEvidencePacket,
} from '../evidencePackets';
import { getEvalRunDetail, listEvalRuns, listEvalSuites, runEvalSuite } from '../evals';
import {
  buildCapabilityFlightRecorderSnapshot,
  buildWorkItemFlightRecorderDetail,
  getFlightRecorderDownloadName,
  renderCapabilityFlightRecorderMarkdown,
  renderWorkItemFlightRecorderMarkdown,
} from '../flightRecorder';
import {
  listCompletedWorkOrders,
  listLedgerArtifacts,
} from '../ledger';
import { listMemoryDocuments, refreshCapabilityMemory, searchCapabilityMemory } from '../memory';
import { parseActorContext } from '../requestActor';
import {
  buildAuditReportSnapshot,
  buildCapabilityHealthSnapshot,
  buildCollectionRollupSnapshot,
  buildExecutiveSummarySnapshot,
  buildGovernanceCostAllocationSnapshot,
  buildOperationsDashboardSnapshot,
  buildReportExportPayload,
  buildTeamQueueSnapshot,
  buildWorkItemEfficiencySnapshot,
} from '../reporting';
import {
  buildWorkItemExplainDetail,
  generateReviewPacketForWorkItem,
} from '../workItemExplain';

export const registerReportingEvidenceRoutes = (app: express.Express) => {
  app.get('/api/reports/operations', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.operations' });
      response.json(await buildOperationsDashboardSnapshot(actor));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/reports/team/:teamId', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const permissions = await assertWorkspacePermission({
        actor,
        action: 'report.view.operations',
      });
      if (
        !permissions.workspaceRoles.includes('WORKSPACE_ADMIN') &&
        !permissions.workspaceRoles.includes('PORTFOLIO_OWNER') &&
        !permissions.workspaceRoles.includes('AUDITOR') &&
        !actor.teamIds.includes(request.params.teamId)
      ) {
        throw new Error(
          'Forbidden: team reports are not allowed outside the current actor team scope.',
        );
      }
      response.json(
        await buildTeamQueueSnapshot({
          actor,
          teamId: request.params.teamId,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/reports/capability/:capabilityId', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'capability.read.rollup',
      });
      response.json(
        await buildCapabilityHealthSnapshot({
          actor,
          capabilityId: request.params.capabilityId,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/reports/work-items/:capabilityId', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'capability.read.rollup',
      });
      response.json(
        await buildWorkItemEfficiencySnapshot({
          actor,
          capabilityId: request.params.capabilityId,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/reports/collection/:capabilityId', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'capability.read.rollup',
      });
      response.json(
        await buildCollectionRollupSnapshot({
          actor,
          capabilityId: request.params.capabilityId,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/reports/executive', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.executive' });
      response.json(await buildExecutiveSummarySnapshot(actor));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/reports/audit', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });
      response.json(await buildAuditReportSnapshot(actor));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/reports/governance-cost-allocation', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });
      const daysRaw = Number.parseInt(String(request.query.days || ''), 10);
      response.json(
        await buildGovernanceCostAllocationSnapshot({
          actor,
          windowDays: Number.isFinite(daysRaw) ? daysRaw : 7,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/reports/export/:reportType', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const reportType = String(request.params.reportType || '').trim();
      let payload:
        | Awaited<ReturnType<typeof buildOperationsDashboardSnapshot>>
        | Awaited<ReturnType<typeof buildTeamQueueSnapshot>>
        | Awaited<ReturnType<typeof buildCapabilityHealthSnapshot>>
        | Awaited<ReturnType<typeof buildCollectionRollupSnapshot>>
        | Awaited<ReturnType<typeof buildExecutiveSummarySnapshot>>
        | Awaited<ReturnType<typeof buildAuditReportSnapshot>>;

      if (reportType === 'operations') {
        await assertWorkspacePermission({ actor, action: 'report.view.operations' });
        payload = await buildOperationsDashboardSnapshot(actor);
      } else if (reportType === 'team') {
        await assertWorkspacePermission({ actor, action: 'report.view.operations' });
        payload = await buildTeamQueueSnapshot({
          actor,
          teamId: String(request.query.teamId || ''),
        });
      } else if (reportType === 'capability') {
        const capabilityId = String(request.query.capabilityId || '');
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.read.rollup',
        });
        payload = await buildCapabilityHealthSnapshot({ actor, capabilityId });
      } else if (reportType === 'collection') {
        const capabilityId = String(request.query.capabilityId || '');
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.read.rollup',
        });
        payload = await buildCollectionRollupSnapshot({ actor, capabilityId });
      } else if (reportType === 'executive') {
        await assertWorkspacePermission({ actor, action: 'report.view.executive' });
        payload = await buildExecutiveSummarySnapshot(actor);
      } else if (reportType === 'audit') {
        await assertWorkspacePermission({ actor, action: 'report.view.audit' });
        payload = await buildAuditReportSnapshot(actor);
      } else {
        response.status(400).json({ error: 'Unknown report type.' });
        return;
      }

      response.json(
        buildReportExportPayload({
          reportType: reportType as ReportExportPayload['reportType'],
          payload,
          filters: {
            capabilityId: String(request.query.capabilityId || '').trim() || undefined,
            teamId: String(request.query.teamId || '').trim() || undefined,
          },
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/memory/documents', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      response.json(
        await listMemoryDocuments(
          request.params.capabilityId,
          String(request.query.agentId || '').trim() || undefined,
        ),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/memory/search', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      response.json(
        await searchCapabilityMemory({
          capabilityId: request.params.capabilityId,
          agentId: String(request.query.agentId || '').trim() || undefined,
          queryText: String(request.query.q || ''),
          limit: Number(request.query.limit || 8),
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/memory/refresh', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'agents.manage',
      });
      const documents = await refreshCapabilityMemory(request.params.capabilityId, {
        requeueAgents: true,
        requestReason: 'manual-memory-refresh',
      });
      wakeAgentLearningWorker();
      response.json(documents);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get(
    '/api/capabilities/:capabilityId/agents/:agentId/learning',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'capability.read',
        });
        response.json(
          await getAgentLearningProfileDetail(
            request.params.capabilityId,
            request.params.agentId,
          ),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/agents/:agentId/learning/refresh',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'agents.manage',
        });
        await queueSingleAgentLearningRefresh(
          request.params.capabilityId,
          request.params.agentId,
          'manual-agent-refresh',
        );
        wakeAgentLearningWorker();
        response.json(
          await getAgentLearningProfileDetail(
            request.params.capabilityId,
            request.params.agentId,
          ),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/agents/:agentId/learning/corrections',
    async (request, response) => {
      const correction = String(request.body?.correction || '').trim();
      if (!correction) {
        response.status(400).json({
          error: 'A learning correction is required.',
        });
        return;
      }

      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'capability.edit',
        });
        await applyAgentLearningCorrection({
          capabilityId: request.params.capabilityId,
          agentId: request.params.agentId,
          correction,
          workItemId: String(request.body?.workItemId || '').trim() || undefined,
          runId: String(request.body?.runId || '').trim() || undefined,
          actor,
        });
        wakeAgentLearningWorker();
        response.json(
          await getAgentLearningProfileDetail(
            request.params.capabilityId,
            request.params.agentId,
          ),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Chat-driven learning. Reads the last N messages of the given chat session
  // between the caller and this agent, asks the model to distill durable
  // corrections/preferences, and pipes the result through
  // applyAgentLearningCorrection — same shape-check gate as a manual
  // correction. Idempotent: pass force=true to re-distill a session.
  app.post(
    '/api/capabilities/:capabilityId/agents/:agentId/chat-sessions/:sessionId/distill',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'capability.edit',
        });
        const agentName = String(request.body?.agentName || '').trim() || 'Agent';
        const result = await distillAgentChatSession({
          capabilityId: request.params.capabilityId,
          agentId: request.params.agentId,
          agentName,
          sessionId: request.params.sessionId,
          actor,
          workItemId: String(request.body?.workItemId || '').trim() || undefined,
          runId: String(request.body?.runId || '').trim() || undefined,
          force: Boolean(request.body?.force),
        });
        if (result.status === 'APPLIED') {
          wakeAgentLearningWorker();
        }
        response.json(result);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Slice A — append-only version history for an agent's learning profile.
  app.get(
    '/api/capabilities/:capabilityId/agents/:agentId/learning/versions',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'capability.read',
        });
        const limit = Number(request.query?.limit ?? 25);
        const offset = Number(request.query?.offset ?? 0);
        const versions = await getAgentLearningProfileVersionHistory(
          request.params.capabilityId,
          request.params.agentId,
          {
            limit: Number.isFinite(limit) ? limit : undefined,
            offset: Number.isFinite(offset) ? offset : undefined,
          },
        );
        response.json({ versions });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Slice A — structured diff between two versions. `against` is the older
  // baseline to compare `:versionId` against.
  app.get(
    '/api/capabilities/:capabilityId/agents/:agentId/learning/versions/:versionId/diff',
    async (request, response) => {
      const against = String(request.query?.against || '').trim();
      if (!against) {
        response.status(400).json({
          error: 'A `against` query parameter (baseline version id) is required.',
        });
        return;
      }
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'capability.read',
        });
        response.json(
          await getAgentLearningProfileVersionDiff(
            request.params.capabilityId,
            request.params.agentId,
            request.params.versionId,
            against,
          ),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Slice A — operator-initiated revert. Flips the live pointer to a prior
  // version and appends a VERSION_REVERTED audit event to the learning log.
  app.post(
    '/api/capabilities/:capabilityId/agents/:agentId/learning/versions/:versionId/activate',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'agents.manage',
        });
        await activateAgentLearningProfileVersionWithAudit({
          capabilityId: request.params.capabilityId,
          agentId: request.params.agentId,
          versionId: request.params.versionId,
          actor,
          reason: String(request.body?.reason || '').trim() || undefined,
        });
        response.json(
          await getAgentLearningProfileDetail(
            request.params.capabilityId,
            request.params.agentId,
          ),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Slice C — current canary state + latest drift signals for the lens.
  app.get(
    '/api/capabilities/:capabilityId/agents/:agentId/learning/drift',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'capability.read',
        });
        const state = await getAgentLearningDriftState(
          request.params.capabilityId,
          request.params.agentId,
        );
        response.json({ state });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // ─── Agent Mind ───────────────────────────────────────────────────────────
  app.get(
    '/api/capabilities/:capabilityId/agents/:agentId/mind',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'capability.read',
        });
        const snapshot = await getAgentMindSnapshot(
          request.params.capabilityId,
          request.params.agentId,
        );
        response.json(snapshot);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get('/api/capabilities/:capabilityId/evals/suites', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      response.json(await listEvalSuites(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/evals/runs', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      response.json(await listEvalRuns(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/evals/runs/:runId', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      response.json(
        await getEvalRunDetail(request.params.capabilityId, request.params.runId),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post(
    '/api/capabilities/:capabilityId/evals/suites/:suiteId/run',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workflow.edit',
        });
        response
          .status(201)
          .json(await runEvalSuite(request.params.capabilityId, request.params.suiteId));
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get('/api/capabilities/:capabilityId/ledger/artifacts', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'artifact.read',
      });
      response.json(await listLedgerArtifacts(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get(
    '/api/capabilities/:capabilityId/ledger/completed-work-orders',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'artifact.read',
        });
        response.json(await listCompletedWorkOrders(request.params.capabilityId));
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get('/api/capabilities/:capabilityId/flight-recorder', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'telemetry.read',
      });
      response.json(
        await buildCapabilityFlightRecorderSnapshot(request.params.capabilityId),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get(
    '/api/capabilities/:capabilityId/flight-recorder/download',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'telemetry.read',
        });
        const format = request.query.format === 'markdown' ? 'markdown' : 'json';
        const snapshot = await buildCapabilityFlightRecorderSnapshot(
          request.params.capabilityId,
        );
        response.setHeader(
          'Content-Type',
          format === 'markdown'
            ? 'text/markdown; charset=utf-8'
            : 'application/json; charset=utf-8',
        );
        response.setHeader(
          'Content-Disposition',
          `attachment; filename="${getFlightRecorderDownloadName({
            title: `${request.params.capabilityId}-flight-recorder`,
            format,
          })}"`,
        );
        response.send(
          format === 'markdown'
            ? renderCapabilityFlightRecorderMarkdown(snapshot)
            : JSON.stringify(snapshot, null, 2),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    '/api/capabilities/:capabilityId/work-items/:workItemId/flight-recorder',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'telemetry.read',
        });
        response.json(
          await buildWorkItemFlightRecorderDetail(
            request.params.capabilityId,
            request.params.workItemId,
          ),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    '/api/capabilities/:capabilityId/work-items/:workItemId/explain',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'workitem.read',
        });
        response.json(
          await buildWorkItemExplainDetail(
            request.params.capabilityId,
            request.params.workItemId,
          ),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/work-items/:workItemId/review-packet',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'artifact.read',
        });
        response.status(201).json(
          await generateReviewPacketForWorkItem(
            request.params.capabilityId,
            request.params.workItemId,
          ),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/work-items/:workItemId/evidence-packets',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'artifact.read',
        });
        response.status(201).json(
          await createEvidencePacketForWorkItem({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get('/api/evidence-packets/:bundleId', async (request, response) => {
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
      response.json(formatEvidencePacketForDisplay(packet));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  // Slice A — Signed Change Attestation chain: root-first ordered chain of
  // attestations sharing the same chain_root_bundle_id. The UI surface keeps
  // the "packet" vocabulary; the `/api/attestations/*` namespace is for
  // verifier tooling that wants to work with the chain directly.
  app.get('/api/attestations/:bundleId/chain', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const chain = await getAttestationChain(request.params.bundleId);
      if (!chain || chain.entries.length === 0) {
        response.status(404).json({ error: 'Attestation was not found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: chain.entries[0].capabilityId,
        actor,
        action: 'artifact.read',
      });
      response.json(chain);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  // Slice A — verify a single attestation: recomputes SHA256 digest, checks
  // Ed25519 signature (when signed), and walks prev_bundle_id backwards to
  // confirm chain integrity (no gaps, no cycles, root reached).
  app.post('/api/attestations/:bundleId/verify', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const packet = await getEvidencePacket(request.params.bundleId);
      if (!packet) {
        response.status(404).json({ error: 'Attestation was not found.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId: packet.capabilityId,
        actor,
        action: 'artifact.read',
      });
      const result = await verifyEvidencePacket(request.params.bundleId);
      if (!result) {
        response.status(404).json({ error: 'Attestation was not found.' });
        return;
      }
      response.json(result);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  // Governance Slice 1 — idempotent GET form of the attestation verify route,
  // namespaced under /api/evidence-packets for UI ergonomics. Same underlying
  // verification; adds chainDepth + chainRootBundleId to the response so the UI
  // drawer can display the walk-back summary without a follow-up call.
  app.get('/api/evidence-packets/:bundleId/verify', async (request, response) => {
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
      const result = await verifyEvidencePacket(request.params.bundleId);
      if (!result) {
        response.status(404).json({ error: 'Evidence packet was not found.' });
        return;
      }
      response.json(result);
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
