export type CopilotTranscriptBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      toolName: string;
      parameters: Array<{ name: string; value: string }>;
    }
  | { type: 'system'; text: string };

const WRAPPER_TAG_PATTERN = /<\/?(?:function_calls|tool_calls|thinking)>|<\/invoke_tool_name>/gi;
const TOKEN_PATTERN =
  /<invoke_tool_name>([\s\S]*?)<\/invoke_tool_name>|<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>|<system_notification>([\s\S]*?)<\/system_notification>/gi;

const normalizeChunk = (value: string) =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(WRAPPER_TAG_PATTERN, '\n')
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

    if (typeof match[1] === 'string') {
      flushPendingTool();
      pendingTool = {
        type: 'tool',
        toolName: normalizeChunk(match[1]),
        parameters: [],
      };
    } else if (typeof match[2] === 'string') {
      if (!pendingTool) {
        pendingTool = {
          type: 'tool',
          toolName: '',
          parameters: [],
        };
      }
      pendingTool.parameters.push({
        name: normalizeChunk(match[2]) || 'value',
        value: normalizeChunk(match[3] || ''),
      });
    } else if (typeof match[4] === 'string') {
      flushPendingTool();
      const text = normalizeChunk(match[4]);
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
