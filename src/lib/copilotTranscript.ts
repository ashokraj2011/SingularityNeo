export type CopilotTranscriptBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      toolName: string;
      parameters: Array<{ name: string; value: string }>;
    }
  | { type: 'system'; text: string };

// Scaffold tags that different model families wrap around tool invocations.
// Stripped from raw text so they never leak into rendered message bodies.
// Covers: Anthropic `<*>`, OpenAI-style `<function_calls>/<tool_calls>`,
// Llama/Qwen/DeepSeek `<tool_call>`, and generic `<thinking>/<invoke>` tokens.
//
// We intentionally match these as *standalone* tags (open OR close, with or
// without attributes) so that malformed/unbalanced fragments streamed from
// the model still get cleaned up — e.g. a stray `</tool_call>` by itself, or
// a `<function_name>foo</parameter>` with mismatched closers.
const SCAFFOLD_TAGS = [
  'antml:function_calls',
  'antml:invoke',
  'antml:parameter',
  'function_calls',
  'tool_calls',
  'tool_call',
  'invoke',
  'parameter',
  'invoke_tool_name',
  'function_name',
  'thinking',
  'system_notification',
].join('|');
const SCAFFOLD_TAG_PATTERN = new RegExp(`<\\/?(?:${SCAFFOLD_TAGS})\\b[^>]*>`, 'gi');

const TOKEN_PATTERN =
  /<(?:antml:invoke|invoke)\s+name="([^"]+)"[^>]*>|<invoke_tool_name>([\s\S]*?)<\/invoke_tool_name>|<function_name>([\s\S]*?)<\/function_name>|<(?:antml:parameter|parameter)\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:antml:parameter|parameter)>|<system_notification>([\s\S]*?)<\/system_notification>/gi;

const normalizeChunk = (value: string) =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(SCAFFOLD_TAG_PATTERN, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const parseCopilotTranscriptBlocks = (
  content: string,
): CopilotTranscriptBlock[] => {
  const normalized = String(content || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) {
    return [];
  }

  const blocks: CopilotTranscriptBlock[] = [];
  let pendingTool:
    | {
        type: 'tool';
        toolName: string;
        parameters: Array<{ name: string; value: string }>;
      }
    | null = null;
  let lastIndex = 0;

  const flushPendingTool = () => {
    if (!pendingTool) {
      return;
    }
    if (pendingTool.toolName || pendingTool.parameters.length > 0) {
      blocks.push(pendingTool);
    }
    pendingTool = null;
  };

  const appendText = (value: string) => {
    const cleaned = normalizeChunk(value);
    if (!cleaned) {
      return;
    }
    flushPendingTool();
    blocks.push({ type: 'text', text: cleaned });
  };

  for (const match of normalized.matchAll(TOKEN_PATTERN)) {
    appendText(normalized.slice(lastIndex, match.index));

    // Groups:
    //   1 — <invoke name="X"> / <invoke name="X">  (tool name via attr)
    //   2 — <invoke_tool_name>X</invoke_tool_name>        (legacy tool name)
    //   3 — <function_name>X</function_name>              (OSS tool name)
    //   4 — parameter name attr  (paired with group 5)
    //   5 — parameter value      (paired with group 4)
    //   6 — <system_notification>X</system_notification>
    const toolNameFromAttr = match[1];
    const toolNameFromInvoke = match[2];
    const toolNameFromFunction = match[3];
    const parameterName = match[4];
    const parameterValue = match[5];
    const systemText = match[6];

    const resolvedToolName =
      typeof toolNameFromAttr === 'string'
        ? toolNameFromAttr
        : typeof toolNameFromInvoke === 'string'
        ? toolNameFromInvoke
        : typeof toolNameFromFunction === 'string'
        ? toolNameFromFunction
        : null;

    if (resolvedToolName !== null) {
      flushPendingTool();
      pendingTool = {
        type: 'tool',
        toolName: normalizeChunk(resolvedToolName),
        parameters: [],
      };
    } else if (typeof parameterName === 'string') {
      if (!pendingTool) {
        pendingTool = {
          type: 'tool',
          toolName: '',
          parameters: [],
        };
      }
      pendingTool.parameters.push({
        name: normalizeChunk(parameterName) || 'value',
        value: normalizeChunk(parameterValue || ''),
      });
    } else if (typeof systemText === 'string') {
      flushPendingTool();
      const text = normalizeChunk(systemText);
      if (text) {
        blocks.push({ type: 'system', text });
      }
    }

    lastIndex = (match.index ?? 0) + match[0].length;
  }

  appendText(normalized.slice(lastIndex));
  flushPendingTool();

  if (blocks.length === 0) {
    const fallbackText = normalizeChunk(normalized);
    return fallbackText ? [{ type: 'text', text: fallbackText }] : [];
  }

  return blocks;
};
