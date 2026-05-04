import type {
  EvalCase,
  EvalRun,
  EvalRunCaseResult,
  EvalRunDetail,
  EvalSuite,
} from '../src/types';
import { isTestingWorkflowStep } from '../src/lib/workflowStepSemantics';
import { WORKSPACE_EVAL_SUITE_TEMPLATES } from '../src/lib/workspaceFoundations';
import { getCapabilityBundle } from './domains/self-service/repository';
import { buildMemoryContext, refreshCapabilityMemory } from './memory';
import { query } from './db';
import { defaultModel, requestGitHubModel } from './githubModels';

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const suiteFromRow = (row: Record<string, any>): EvalSuite => ({
  id: row.id,
  capabilityId: row.capability_id,
  name: row.name,
  description: row.description,
  agentRole: row.agent_role,
  evalType: row.eval_type,
  enabled: Boolean(row.enabled),
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
});

const caseFromRow = (row: Record<string, any>): EvalCase => ({
  id: row.id,
  capabilityId: row.capability_id,
  suiteId: row.suite_id,
  name: row.name,
  description: row.description,
  input: row.input || {},
  expected: row.expected || {},
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
});

const runFromRow = (row: Record<string, any>): EvalRun => ({
  id: row.id,
  capabilityId: row.capability_id,
  suiteId: row.suite_id,
  status: row.status,
  traceId: row.trace_id || undefined,
  judgeModel: row.judge_model || undefined,
  score: typeof row.score === 'number' ? row.score : row.score ? Number(row.score) : undefined,
  summary: row.summary || undefined,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  completedAt: row.completed_at ? (row.completed_at instanceof Date ? row.completed_at.toISOString() : String(row.completed_at)) : undefined,
});

const resultFromRow = (row: Record<string, any>): EvalRunCaseResult => ({
  id: row.id,
  capabilityId: row.capability_id,
  evalRunId: row.eval_run_id,
  evalCaseId: row.eval_case_id,
  status: row.status,
  score: Number(row.score || 0),
  summary: row.summary,
  details: row.details || undefined,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
});

const ensureEvalSuites = async (capabilityId: string) => {
  const suiteCount = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM capability_eval_suites
      WHERE capability_id = $1
    `,
    [capabilityId],
  );

  if (Number(suiteCount.rows[0]?.count || 0) > 0) {
    return;
  }

  for (const suite of WORKSPACE_EVAL_SUITE_TEMPLATES) {
    await query(
      `
        INSERT INTO capability_eval_suites (
          capability_id,
          id,
          name,
          description,
          agent_role,
          eval_type,
          enabled,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      `,
      [
        capabilityId,
        suite.id,
        suite.name,
        suite.description,
        suite.agentRole,
        suite.evalType,
        true,
      ],
    );

    for (const evalCase of suite.cases) {
      await query(
        `
          INSERT INTO capability_eval_cases (
            capability_id,
            id,
            suite_id,
            name,
            description,
            input,
            expected,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        `,
        [
          capabilityId,
          evalCase.id,
          suite.id,
          evalCase.name,
          evalCase.description,
          evalCase.input,
          evalCase.expected,
        ],
      );
    }
  }
};

export const listEvalSuites = async (capabilityId: string) => {
  await ensureEvalSuites(capabilityId);
  const result = await query(
    `
      SELECT *
      FROM capability_eval_suites
      WHERE capability_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [capabilityId],
  );

  return result.rows.map(suiteFromRow);
};

export const listEvalRuns = async (capabilityId: string) => {
  await ensureEvalSuites(capabilityId);
  const result = await query(
    `
      SELECT *
      FROM capability_eval_runs
      WHERE capability_id = $1
      ORDER BY created_at DESC, id DESC
    `,
    [capabilityId],
  );

  return result.rows.map(runFromRow);
};

export const getEvalRunDetail = async (
  capabilityId: string,
  runId: string,
): Promise<EvalRunDetail> => {
  const [runResult, resultRows] = await Promise.all([
    query(
      `
        SELECT runs.*, suites.name AS suite_name, suites.description AS suite_description, suites.agent_role, suites.eval_type, suites.enabled, suites.created_at AS suite_created_at, suites.updated_at AS suite_updated_at
        FROM capability_eval_runs runs
        JOIN capability_eval_suites suites
          ON suites.capability_id = runs.capability_id
         AND suites.id = runs.suite_id
        WHERE runs.capability_id = $1 AND runs.id = $2
      `,
      [capabilityId, runId],
    ),
    query(
      `
        SELECT *
        FROM capability_eval_run_results
        WHERE capability_id = $1 AND eval_run_id = $2
        ORDER BY created_at ASC, id ASC
      `,
      [capabilityId, runId],
    ),
  ]);

  if (!runResult.rowCount) {
    throw new Error(`Eval run ${runId} was not found.`);
  }

  const runRow = runResult.rows[0] as Record<string, any>;
  const suite = suiteFromRow({
    ...runRow,
    id: runRow.suite_id,
    name: runRow.suite_name,
    description: runRow.suite_description,
    agent_role: runRow.agent_role,
    eval_type: runRow.eval_type,
    enabled: runRow.enabled,
    created_at: runRow.suite_created_at,
    updated_at: runRow.suite_updated_at,
  });
  const casesResult = await query(
    `
      SELECT *
      FROM capability_eval_cases
      WHERE capability_id = $1 AND suite_id = $2
      ORDER BY created_at ASC, id ASC
    `,
    [capabilityId, suite.id],
  );

  return {
    run: runFromRow(runRow),
    suite,
    cases: casesResult.rows.map(caseFromRow),
    results: resultRows.rows.map(resultFromRow),
  };
};

const insertEvalResult = async (
  result: Omit<EvalRunCaseResult, 'id' | 'createdAt'>,
) => {
  await query(
    `
      INSERT INTO capability_eval_run_results (
        capability_id,
        id,
        eval_run_id,
        eval_case_id,
        status,
        score,
        summary,
        details
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      result.capabilityId,
      createId('EVALRESULT'),
      result.evalRunId,
      result.evalCaseId,
      result.status,
      result.score,
      result.summary,
      result.details || {},
    ],
  );
};

const judgeEvalSummary = async ({
  suite,
  results,
}: {
  suite: EvalSuite;
  results: EvalRunCaseResult[];
}) => {
  try {
    // No `model` / `providerKey` overrides — let requestGitHubModel resolve
    // through the operator's configured runtime (normalizeProviderKey defaults
    // to the operator's selected provider; resolveModelForProvider picks that
    // provider's default model). The eval summary should not pin a specific
    // model that may not be available on the operator's chosen runtime.
    const response = await requestGitHubModel({
      maxTokens: 400,
      temperature: 0.1,
      timeoutMs: 8000,
      messages: [
        {
          role: 'system',
          content: 'You summarize evaluation outcomes for an enterprise AI platform. Respond with plain text only.',
        },
        {
          role: 'user',
          content: `Suite: ${suite.name}\nResults:\n${results
            .map(result => `${result.status} (${result.score}%): ${result.summary}`)
            .join('\n')}\n\nProvide a concise quality summary and the main risk if any.`,
        },
      ],
    });
    return {
      judgeModel: response.model,
      summary: response.content,
    };
  } catch {
    return {
      judgeModel: defaultModel,
      summary:
        results.every(result => result.status === 'PASSED')
          ? 'All evaluation cases passed for this suite.'
          : 'One or more evaluation cases failed. Review the detailed case summaries for the highest-risk gaps.',
    };
  }
};

export const runEvalSuite = async (
  capabilityId: string,
  suiteId: string,
) => {
  await ensureEvalSuites(capabilityId);
  await refreshCapabilityMemory(capabilityId).catch(() => undefined);
  const [bundle, suiteResult, caseResult] = await Promise.all([
    getCapabilityBundle(capabilityId),
    query(
      `
        SELECT *
        FROM capability_eval_suites
        WHERE capability_id = $1 AND id = $2
      `,
      [capabilityId, suiteId],
    ),
    query(
      `
        SELECT *
        FROM capability_eval_cases
        WHERE capability_id = $1 AND suite_id = $2
        ORDER BY created_at ASC, id ASC
      `,
      [capabilityId, suiteId],
    ),
  ]);

  if (!suiteResult.rowCount) {
    throw new Error(`Eval suite ${suiteId} was not found.`);
  }

  const suite = suiteFromRow(suiteResult.rows[0]);
  const cases = caseResult.rows.map(caseFromRow);
  const runId = createId('EVALRUN');

  await query(
    `
      INSERT INTO capability_eval_runs (
        capability_id,
        id,
        suite_id,
        status
      )
      VALUES ($1,$2,$3,'RUNNING')
    `,
    [capabilityId, runId, suiteId],
  );

  const results: EvalRunCaseResult[] = [];
  for (const evalCase of cases) {
    let status: EvalRunCaseResult['status'] = 'PASSED';
    let score = 100;
    let summary = 'Case passed.';
    let details: Record<string, any> = {};

    if (suite.evalType === 'STRUCTURED_OUTPUT') {
      if (evalCase.input.agentRole === 'Architect') {
        const architect = bundle.workspace.agents.find(agent => agent.role === 'Architect');
        const workflowsWithAllowlists = bundle.workspace.workflows.filter(workflow =>
          workflow.steps.every(step => Array.isArray(step.allowedToolIds)),
        );
        const passed = Boolean(architect) && workflowsWithAllowlists.length > 0;
        status = passed ? 'PASSED' : 'FAILED';
        score = passed ? 100 : 25;
        summary = passed
          ? 'Built-in Architect agent exists and workflow steps define explicit tool allowlists.'
          : 'Architect coverage or tool allowlist configuration is incomplete.';
        details = {
          hasArchitect: Boolean(architect),
          workflowsWithAllowlists: workflowsWithAllowlists.length,
        };
      }
    } else if (suite.evalType === 'RETRIEVAL') {
      const memory = await buildMemoryContext({
        capabilityId,
        queryText: String(evalCase.input.queryText || bundle.capability.name),
      });
      const passed = memory.results.some(
        result => result.reference.sourceType === evalCase.expected.sourceType,
      );
      status = passed ? 'PASSED' : 'FAILED';
      score = passed ? 100 : 40;
      summary = passed
        ? 'Relevant capability memory was retrieved with provenance.'
        : 'Capability memory retrieval did not return the expected long-term context.';
      details = {
        hits: memory.results.map(result => ({
          title: result.document.title,
          sourceType: result.document.sourceType,
          score: result.reference.score,
        })),
      };
    } else {
      const approvalSteps = bundle.workspace.workflows.flatMap(workflow =>
        workflow.steps.filter(step => step.stepType === 'HUMAN_APPROVAL'),
      );
      const handoffSteps = bundle.workspace.workflows.flatMap(workflow =>
        workflow.steps.filter(step => step.handoffToAgentId || step.handoffToPhase),
      );
      const workflowsWithTestingCoverage = bundle.workspace.workflows.filter(workflow =>
        workflow.steps.some(step => isTestingWorkflowStep(step)),
      );
      const passed =
        approvalSteps.length > 0 &&
        handoffSteps.length > 0 &&
        workflowsWithTestingCoverage.length > 0;
      status = passed ? 'PASSED' : 'FAILED';
      score = passed ? 100 : 35;
      summary = passed
        ? 'Workflow safety controls, hand-offs, and QA coverage are present.'
        : 'Workflow safety controls are missing required approval, hand-off, or QA coverage.';
      details = {
        approvalSteps: approvalSteps.length,
        handoffSteps: handoffSteps.length,
        qaWorkflowCount: workflowsWithTestingCoverage.length,
      };
    }

    const caseResultRecord: EvalRunCaseResult = {
      id: createId('EVALRESULT'),
      capabilityId,
      evalRunId: runId,
      evalCaseId: evalCase.id,
      status,
      score,
      summary,
      details,
      createdAt: new Date().toISOString(),
    };
    await insertEvalResult(caseResultRecord);
    results.push(caseResultRecord);
  }

  const averageScore =
    results.reduce((sum, result) => sum + result.score, 0) / Math.max(results.length, 1);
  const judged = await judgeEvalSummary({ suite, results });

  await query(
    `
      UPDATE capability_eval_runs
      SET
        status = 'COMPLETED',
        score = $3,
        judge_model = $4,
        summary = $5,
        completed_at = NOW()
      WHERE capability_id = $1 AND id = $2
    `,
    [capabilityId, runId, Number(averageScore.toFixed(2)), judged.judgeModel, judged.summary],
  );

  return getEvalRunDetail(capabilityId, runId);
};
