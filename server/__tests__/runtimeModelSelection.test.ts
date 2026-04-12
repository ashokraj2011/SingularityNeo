// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  pickLowestCostRuntimeModel,
  rankRuntimeModelsByAffordability,
} from '../githubModels';

describe('runtime model affordability ranking', () => {
  it('prefers free and low-cost profiles before broader premium profiles', () => {
    const models = [
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        profile: 'Broader capability',
        apiModelId: 'gpt-4o',
      },
      {
        id: 'gpt-4.1-mini',
        label: 'GPT-4.1 Mini',
        profile: 'Lowest cost',
        apiModelId: 'gpt-4.1-mini',
      },
      {
        id: 'workspace/free-model',
        label: 'Workspace Free',
        profile: 'Included',
        apiModelId: 'workspace/free-model',
      },
    ];

    expect(pickLowestCostRuntimeModel(models)?.apiModelId).toBe(
      'workspace/free-model',
    );
  });

  it('treats mini and fast models as cheaper than balanced or broader ones', () => {
    const models = [
      {
        id: 'gpt-4.1',
        label: 'GPT-4.1',
        profile: 'Balanced reasoning',
        apiModelId: 'gpt-4.1',
      },
      {
        id: 'o4-mini',
        label: 'o4-mini',
        profile: 'Reasoning supported',
        apiModelId: 'o4-mini',
      },
      {
        id: 'claude-sonnet-4.5',
        label: 'Claude Sonnet 4.5',
        profile: 'Available',
        apiModelId: 'claude-sonnet-4.5',
      },
    ];

    expect(rankRuntimeModelsByAffordability(models).map(model => model.apiModelId)).toEqual([
      'o4-mini',
      'gpt-4.1',
      'claude-sonnet-4.5',
    ]);
  });
});
