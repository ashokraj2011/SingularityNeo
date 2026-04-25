export type CopilotTranscriptBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      toolName: string;
      parameters: Array<{ name: string; value: string }>;
    }
  | { type: 'system'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_result'; toolName: string; content: string };

// ---------------------------------------------------------------------------
// SCAFFOLD_TAGS — standalone open/close tags that should NEVER appear as
// visible text in a rendered message bubble.  We match them as bare tags
// (with or without attributes) so stray/unbalanced fragments from streaming
// still get cleaned up.
//
// Covers:
//   Anthropic native  — antml:function_calls, antml:invoke, antml:parameter,
//                       antml:thinking
//   OpenAI / generic  — function_calls, tool_calls, tool_call, invoke,
//                       parameter, function_name, invoke_tool_name
//   Tool result wrappers — tool_result, function_results, result,
//                          tool_use_id, stdout, stderr
//   Reasoning tokens  — thinking, scratchpad
//   Misc              — system_notification
// ---------------------------------------------------------------------------
const SCAFFOLD_TAGS = [
  'antml:function_calls',
  'antml:invoke',
  'antml:parameter',
  'antml:thinking',
  'function_calls',
  'tool_calls',
  'tool_call',
  'invoke',
  'parameter',
  'invoke_tool_name',
  'function_name',
  'tool_use_id',
  'tool_result',
  'function_results',
  'result',
  'stdout',
  'stderr',
  'scratchpad',
  'system_notification',
].join('|');

// Matches open OR close tags (with or without attributes) for the scaffold
// set above.  Used by normalizeChunk to strip residual tag fragments that
// weren't captured by the richer TOKEN_PATTERN below.
const SCAFFOLD_TAG_PATTERN = new RegExp(`<\\/?(?:${SCAFFOLD_TAGS})\\b[^>]*>`, 'gi');

// Broad safety-net: strip any remaining XML-looking tags that are NOT standard
// HTML elements.  This catches model-specific tags we haven't enumerated yet
// (e.g. <execute>, <observation>, <bash>, <glob>, <view>, <code_output>).
// We keep well-known HTML tags by explicitly excluding them.
const UNKNOWN_XML_TAG_PATTERN =
  /<\/?(?!(?:a|abbr|b|blockquote|br|button|caption|cite|code|col|colgroup|dd|del|details|dfn|dialog|div|dl|dt|em|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|i|img|input|ins|kbd|label|legend|li|link|main|mark|meta|nav|ol|optgroup|option|p|pre|q|s|samp|section|select|small|span|strong|style|sub|summary|sup|table|tbody|td|template|textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr)\b)[a-z_][a-z0-9_:-]*\b[^>]*>/gi;

// ---------------------------------------------------------------------------
// TOKEN_PATTERN — ordered alternation that extracts meaningful structural
// tokens from raw model output.  Groups:
//
//   1  — <(antml:)?invoke name="X">  →  tool call start (name via attr)
//   2  — <invoke_tool_name>X</>      →  legacy tool name element
//   3  — <function_name>X</>         →  OSS / Llama tool name element
//   4  — parameter name attr  \
//   5  — parameter value       }     →  tool parameter key=value pair
//   6  — <system_notification>X</>  →  system annotation
//   7  — <(antml:)?thinking>X</>     →  extended reasoning block (captured)
//   8  — <tool_result …>X</>         →  tool execution result (captured)
//   9  — <function_results>X</>      →  alternative tool result wrapper
// ---------------------------------------------------------------------------
const TOKEN_PATTERN = new RegExp(
  // 1 — invoke / antml:invoke with name attr
  '<(?:antml:invoke|invoke)\\s+name="([^"]+)"[^>]*>|' +
  // 2 — invoke_tool_name element
  '<invoke_tool_name>([\\s\\S]*?)<\\/invoke_tool_name>|' +
  // 3 — function_name element
  '<function_name>([\\s\\S]*?)<\\/function_name>|' +
  // 4+5 — antml:parameter / parameter with name attr
  '<(?:antml:parameter|parameter)\\s+name="([^"]+)"[^>]*>([\\s\\S]*?)<\\/(?:antml:parameter|parameter)>|' +
  // 6 — system_notification
  '<system_notification>([\\s\\S]*?)<\\/system_notification>|' +
  // 7 — thinking / antml:thinking  (capture content)
  '<(?:antml:thinking|thinking)[^>]*>([\\s\\S]*?)<\\/(?:antml:thinking|thinking)>|' +
  // 8 — tool_result
  '<tool_result[^>]*>([\\s\\S]*?)<\\/tool_result>|' +
  // 9 — function_results
  '<function_results[^>]*>([\\s\\S]*?)<\\/function_results>',
  'gi',
);

// Strip all scaffold-tag residue from a plain-text chunk.
const normalizeChunk = (value: string) =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(SCAFFOLD_TAG_PATTERN, '\n')
    .replace(UNKNOWN_XML_TAG_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Extract the tool name from a <tool_result> block (if present).
const extractToolResultName = (raw: string): { toolName: string; content: string } => {
  const nameMatch = raw.match(/<tool_name[^>]*>([\s\S]*?)<\/tool_name>/i);
  const toolName = nameMatch ? nameMatch[1].trim() : '';
  const content = raw
    .replace(/<tool_name[^>]*>[\s\S]*?<\/tool_name>/gi, '')
    .replace(/<tool_use_id[^>]*>[\s\S]*?<\/tool_use_id>/gi, '')
    .replace(SCAFFOLD_TAG_PATTERN, '')
    .replace(UNKNOWN_XML_TAG_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { toolName, content };
};

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
    if (!pendingTool) return;
    if (pendingTool.toolName || pendingTool.parameters.length > 0) {
      blocks.push(pendingTool);
    }
    pendingTool = null;
  };

  const appendText = (value: string) => {
    const cleaned = normalizeChunk(value);
    if (!cleaned) return;
    flushPendingTool();
    blocks.push({ type: 'text', text: cleaned });
  };

  for (const match of normalized.matchAll(TOKEN_PATTERN)) {
    appendText(normalized.slice(lastIndex, match.index));

    const toolNameFromAttr   = match[1];   // group 1 — invoke name attr
    const toolNameFromInvoke = match[2];   // group 2 — invoke_tool_name element
    const toolNameFromFunc   = match[3];   // group 3 — function_name element
    const parameterName      = match[4];   // group 4 — parameter name attr
    const parameterValue     = match[5];   // group 5 — parameter value
    const systemText         = match[6];   // group 6 — system_notification
    const thinkingText       = match[7];   // group 7 — thinking / antml:thinking
    const toolResultRaw      = match[8];   // group 8 — tool_result
    const funcResultRaw      = match[9];   // group 9 — function_results

    const resolvedToolName =
      typeof toolNameFromAttr   === 'string' ? toolNameFromAttr   :
      typeof toolNameFromInvoke === 'string' ? toolNameFromInvoke :
      typeof toolNameFromFunc   === 'string' ? toolNameFromFunc   :
      null;

    if (resolvedToolName !== null) {
      flushPendingTool();
      pendingTool = { type: 'tool', toolName: normalizeChunk(resolvedToolName), parameters: [] };

    } else if (typeof parameterName === 'string') {
      if (!pendingTool) {
        pendingTool = { type: 'tool', toolName: '', parameters: [] };
      }
      pendingTool.parameters.push({
        name:  normalizeChunk(parameterName)  || 'value',
        value: normalizeChunk(parameterValue || ''),
      });

    } else if (typeof systemText === 'string') {
      flushPendingTool();
      const text = normalizeChunk(systemText);
      if (text) blocks.push({ type: 'system', text });

    } else if (typeof thinkingText === 'string') {
      // Extended reasoning — collapse to a thinking block.
      flushPendingTool();
      const text = normalizeChunk(thinkingText);
      if (text) blocks.push({ type: 'thinking', text });

    } else if (typeof toolResultRaw === 'string') {
      flushPendingTool();
      const { toolName, content: resultContent } = extractToolResultName(toolResultRaw);
      if (resultContent) blocks.push({ type: 'tool_result', toolName, content: resultContent });

    } else if (typeof funcResultRaw === 'string') {
      flushPendingTool();
      const { toolName, content: resultContent } = extractToolResultName(funcResultRaw);
      if (resultContent) blocks.push({ type: 'tool_result', toolName, content: resultContent });
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
