// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from '../../src/types';
import {
  buildToolLoopExhaustedWaitMessage,
  buildRepeatedToolLoopFailureMessage,
  buildExecutionFailureRecoveryMessage,
  extractJsonObject,
  hasConcreteImplementationGuidance,
  getExecutionDecisionRepairReason,
  getRecoverableDecisionFeedback,
  normalizeExecutionDecision,
} from '../execution/service';

const buildStep = (): WorkflowStep => ({
  id: 'STEP-1',
  name: 'Solution Design',
  phase: 'DESIGN',
  stepType: 'DELIVERY',
  agentId: 'AGENT-ARCHITECT',
  action: 'Create the design handoff.',
});

describe('extractJsonObject', () => {
  it('parses the first balanced JSON object from mixed model output', () => {
    const parsed = extractJsonObject(`
The plan is below.

{"action":"complete","reasoning":"Design is straightforward.","summary":"Use App.css to switch the background to red."}

I can provide more detail if needed.
`);

    expect(parsed).toEqual({
      action: 'complete',
      reasoning: 'Design is straightforward.',
      summary: 'Use App.css to switch the background to red.',
    });
  });

  it('handles braces inside JSON strings without breaking extraction', () => {
    const parsed = extractJsonObject(`
\`\`\`json
{"action":"pause_for_input","reasoning":"Need clarification about the literal string {red}.","wait":{"type":"INPUT","message":"Confirm whether the token should remain {red} in the docs."}}
\`\`\`
`);

    expect(parsed).toEqual({
      action: 'pause_for_input',
      reasoning: 'Need clarification about the literal string {red}.',
      wait: {
        type: 'INPUT',
        message: 'Confirm whether the token should remain {red} in the docs.',
      },
    });
  });
});

describe('buildExecutionFailureRecoveryMessage', () => {
  it('turns malformed JSON failures into a guidance request', () => {
    const message = buildExecutionFailureRecoveryMessage(
      buildStep(),
      'Model response did not contain valid JSON.',
    );

    expect(message).toContain('malformed structured output');
    expect(message).toContain('Actual failure: Model response did not contain valid JSON.');
  });

  it('keeps timeout failures actionable', () => {
    const message = buildExecutionFailureRecoveryMessage(
      buildStep(),
      'GitHub Copilot SDK timed out while waiting for an assistant response.',
    );

    expect(message).toContain('timed out');
    expect(message).toContain(
      'Actual failure: GitHub Copilot SDK timed out while waiting for an assistant response.',
    );
  });
});

describe('normalizeExecutionDecision', () => {
  it('fills a fallback summary for complete decisions', () => {
    expect(
      normalizeExecutionDecision({
        action: 'complete',
        reasoning: 'Implementation is done.',
      }),
    ).toEqual({
      action: 'complete',
      reasoning: 'Implementation is done.',
      summary: 'Completed the current workflow step.',
    });
  });

  it('downgrades malformed tool decisions without a tool id into a clean failure', () => {
    expect(
      normalizeExecutionDecision({
        action: 'invoke_tool',
        reasoning: 'Need to inspect the workspace before continuing.',
        toolCall: {
          args: {
            pattern: 'todo',
          },
        },
      }),
    ).toEqual({
      action: 'fail',
      reasoning: 'Need to inspect the workspace before continuing.',
      summary:
        'Execution model requested a tool action without specifying a valid tool id.',
    });
  });

  it('maps tool aliases like code_search to the canonical workspace tool id', () => {
    expect(
      normalizeExecutionDecision({
        action: 'invoke_tool',
        reasoning: 'Need to inspect the codebase before continuing.',
        toolCall: {
          toolId: 'code_search',
          args: {
            pattern: 'Operator',
            path: 'src',
          },
        },
      }),
    ).toEqual({
      action: 'invoke_tool',
      reasoning: 'Need to inspect the codebase before continuing.',
      summary: 'Prepared the next tool action for this workflow step.',
      toolCall: {
        toolId: 'workspace_search',
        args: {
          pattern: 'Operator',
          path: 'src',
        },
      },
    });
  });
});

describe('getExecutionDecisionRepairReason', () => {
  it('requests a repair pass when a tool action is missing toolCall.toolId', () => {
    expect(
      getExecutionDecisionRepairReason({
        action: 'invoke_tool',
        toolCall: {
          args: {
            path: 'README.md',
          },
        },
      }),
    ).toBe('Tool action was missing toolCall.toolId.');
  });
});

describe('getRecoverableDecisionFeedback', () => {
  it('treats missing tool ids as recoverable loop feedback', () => {
    expect(
      getRecoverableDecisionFeedback({
        action: 'fail',
        reasoning: 'The tool call was incomplete.',
        summary:
          'Execution model requested a tool action without specifying a valid tool id.',
      }),
    ).toContain('without toolCall.toolId');
  });
});

describe('buildToolLoopExhaustedWaitMessage', () => {
  it('summarizes explored files and attempted tools for guidance waits', () => {
    expect(
      buildToolLoopExhaustedWaitMessage({
        step: buildStep(),
        inspectedPaths: ['src/main/java/App.java', 'src/test/java/AppTest.java'],
        attemptedTools: ['workspace_search', 'workspace_read'],
      }),
    ).toContain('src/main/java/App.java');
  });
});

describe('hasConcreteImplementationGuidance', () => {
  it('rejects vague operator input', () => {
    expect(hasConcreteImplementationGuidance('go ahead')).toBe(false);
    expect(
      hasConcreteImplementationGuidance('create test directory and add test cases'),
    ).toBe(false);
  });

  it('accepts guidance with exact files and commands', () => {
    expect(
      hasConcreteImplementationGuidance(
        'Edit src/main/java/org/example/rules/Operator.java and src/main/java/org/example/rules/RuleEngineService.java to add endsWith/notEndsWith support, then run mvn test from /repo/root.',
      ),
    ).toBe(true);
  });
});

describe('buildRepeatedToolLoopFailureMessage', () => {
  it('explains that repeated retries are no longer allowed', () => {
    expect(
      buildRepeatedToolLoopFailureMessage({
        step: buildStep(),
        inspectedPaths: ['src/main/java/App.java'],
        attemptedTools: ['workspace_read', 'workspace_search'],
      }),
    ).toContain('repeatedly even after human guidance');
  });
});
