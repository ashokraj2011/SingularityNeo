import { describe, expect, it } from 'vitest';
import { parseCopilotTranscriptBlocks } from '../copilotTranscript';

describe('parseCopilotTranscriptBlocks', () => {
  it('turns copilot tool-call markup into structured blocks', () => {
    const blocks = parseCopilotTranscriptBlocks(`
The repo is ready.

<function_calls>
<tool_calls>
<invoke_tool_name>bash</invoke_tool_name>
<parameter name="command">pwd && ls -la</parameter>
</invoke_tool_name>
</tool_calls>
</function_calls>

<system_notification>
Shell command completed.
</system_notification>

Now let me inspect the code.
    `);

    expect(blocks).toEqual([
      { type: 'text', text: 'The repo is ready.' },
      {
        type: 'tool',
        toolName: 'bash',
        parameters: [{ name: 'command', value: 'pwd && ls -la' }],
      },
      { type: 'system', text: 'Shell command completed.' },
      { type: 'text', text: 'Now let me inspect the code.' },
    ]);
  });

  it('returns plain text untouched when no structured markup is present', () => {
    expect(parseCopilotTranscriptBlocks('Simple answer.')).toEqual([
      { type: 'text', text: 'Simple answer.' },
    ]);
  });
});
