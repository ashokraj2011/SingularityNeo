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

  it('parses OSS-style <tool_call><function_name> markup and hides scaffolding', () => {
    const blocks = parseCopilotTranscriptBlocks(`
Looking that up now.

<tool_call>
<function_name>workspace_search</function_name>
<parameter name="query">approval workspace</parameter>
</tool_call>

Here is the result.
    `);

    expect(blocks).toEqual([
      { type: 'text', text: 'Looking that up now.' },
      {
        type: 'tool',
        toolName: 'workspace_search',
        parameters: [{ name: 'query', value: 'approval workspace' }],
      },
      { type: 'text', text: 'Here is the result.' },
    ]);
  });

  it('strips stray/unbalanced tool-call fragments so they never leak into text blocks', () => {
    const blocks = parseCopilotTranscriptBlocks(`
</tool_call>

<tool_call> <function_name>workspace_search</parameter>
    `);

    // The input is garbled markup with no parseable tool call. Expectation:
    // whatever text we surface does NOT contain raw < or > scaffolding.
    for (const block of blocks) {
      if (block.type === 'text') {
        expect(block.text).not.toMatch(/<\/?(tool_call|function_name|parameter|invoke)/i);
      }
    }
  });
});
