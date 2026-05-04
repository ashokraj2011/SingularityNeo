import { describe, expect, it } from 'vitest';
import { getRuntimeStatusIssueMessage } from '../runtimeStatusMessages';

describe('getRuntimeStatusIssueMessage', () => {
  it('surfaces the selected provider validation message', () => {
    const message = getRuntimeStatusIssueMessage({
      configured: false,
      provider: 'Local OpenAI-compatible',
      providerKey: 'local-openai',
      endpoint: 'https://api.openai.com/v1',
      tokenSource: null,
      defaultModel: 'qwen2.5-coder:7b',
      availableModels: [],
      availableProviders: [
        {
          key: 'local-openai',
          label: 'Local OpenAI-compatible',
          transportMode: 'local-openai',
          configured: false,
          supportsSessions: true,
          supportsTools: true,
          supportsWorkspaceAutonomy: false,
          validation: {
            providerKey: 'local-openai',
            ok: false,
            status: 'invalid',
            message:
              'Local OpenAI-compatible runtime is misconfigured: endpoint is OpenAI (https://api.openai.com/v1) but model "qwen2.5-coder:7b" looks local/Ollama.',
            transportMode: 'local-openai',
          },
        },
      ],
    });

    expect(message).toContain('qwen2.5-coder:7b');
    expect(message).toContain('api.openai.com');
  });
});
