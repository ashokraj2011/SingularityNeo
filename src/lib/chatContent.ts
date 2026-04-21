/**
 * Pre-process chat message content before it reaches the markdown
 * renderer.
 *
 * Why this exists:
 *   Some providers (notably Anthropic) emit tool-use XML into the
 *   streamed content when the model "pretends" to call a tool. Our
 *   runtime has no tool loop wired to these messages, so the raw XML
 *   just leaks into the UI. We can't execute them, so the best we can
 *   do is reformat them as a clear "attempted tool call" code block.
 *
 * What we handle:
 *   - <function_calls>…</function_calls> wrappers (Claude's canonical form)
 *   - <function_calls> namespaced variants from training leakage
 *   - <invoke name="X">…</invoke> blocks (nested or bare)
 *   - <parameter name="K">V</parameter>
 *   - <tool_name>X</tool_name> / <function_name>X</function_name> fallbacks
 *   - Orphan closing tags and malformed pairs (streams can truncate mid-tag)
 *
 * Output shape:
 *   A fenced code block with the `tool-call` language hint — the
 *   existing MarkdownContent renderer already styles fenced code, so
 *   we get consistent presentation without touching the renderer.
 */

type Param = { name: string; value: string };

const TAG_PROBE_RE = /<\/?(?:antml:)?(?:function_calls|invoke|parameter|tool_name|function_name)\b/i;

const stripNamespace = (input: string): string =>
  input.replace(/<(\/?)antml:/gi, '<$1');

const formatCallBlock = (toolName: string, params: Param[]): string => {
  const lines: string[] = [];
  if (params.length === 0) {
    lines.push(`${toolName}()`);
  } else {
    lines.push(`${toolName}(`);
    for (const { name, value } of params) {
      if (value.includes('\n')) {
        // Multi-line values (file contents, patches, prompts) — use a
        // triple-quoted block so the shape survives.
        lines.push(`  ${name}: """`);
        for (const lineOfValue of value.split('\n')) {
          lines.push(`    ${lineOfValue}`);
        }
        lines.push('  """,');
      } else {
        lines.push(`  ${name}: ${JSON.stringify(value)},`);
      }
    }
    lines.push(')');
  }

  // Leading/trailing blank lines so the fenced block never fuses with
  // surrounding prose paragraphs.
  return `\n\n\`\`\`tool-call\n${lines.join('\n')}\n\`\`\`\n\n`;
};

const extractToolName = (inner: string): string => {
  const invokeMatch = inner.match(/<invoke\s+name\s*=\s*["']([^"']+)["']/i);
  if (invokeMatch) return invokeMatch[1].trim();

  const namedMatch = inner.match(
    /<(?:tool_name|function_name)\s*>\s*([^<]+?)\s*<\/(?:tool_name|function_name)>/i,
  );
  if (namedMatch) return namedMatch[1].trim();

  return 'tool';
};

const extractParams = (inner: string): Param[] => {
  const params: Param[] = [];
  const paramRe = /<parameter\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
  let match: RegExpExecArray | null;
  while ((match = paramRe.exec(inner)) !== null) {
    params.push({ name: match[1].trim(), value: match[2].trim() });
  }
  return params;
};

const rewriteFunctionCallsBlocks = (input: string): string => {
  // Lenient close: stop at </function_calls>, OR at the next
  // <function_calls> opener (handles missing closes between adjacent
  // blocks), OR at end-of-string (handles truncated streams).
  const re =
    /<function_calls\b[^>]*>([\s\S]*?)(?:<\/function_calls>|(?=<function_calls\b)|$)/gi;
  return input.replace(re, (_match, inner: string) => {
    const toolName = extractToolName(inner);
    const params = extractParams(inner);
    return formatCallBlock(toolName, params);
  });
};

const rewriteBareInvokeBlocks = (input: string): string => {
  // Catches <invoke name="X">…</invoke> that weren't wrapped inside a
  // <function_calls> parent (seen in malformed streams).
  const re = /<invoke\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)(?:<\/invoke>|$)/gi;
  return input.replace(re, (_match, name: string, inner: string) => {
    const params = extractParams(inner);
    return formatCallBlock(name.trim(), params);
  });
};

const stripOrphanTags = (input: string): string => {
  // Any leftover open/close tag for the pseudo-tool-use grammar —
  // these only appear when the stream truncated or the model emitted
  // malformed nesting. Remove them rather than show raw XML.
  return input.replace(
    /<\/?(?:function_calls|invoke|parameter|tool_name|function_name)\b[^>]*>/gi,
    '',
  );
};

/**
 * Reformat Anthropic-style pseudo tool-call XML into readable fenced
 * code blocks. Idempotent and safe to run on every render — the probe
 * regex short-circuits when there's no tag to rewrite.
 */
export const reformatPseudoToolCalls = (raw: string): string => {
  if (!raw || !TAG_PROBE_RE.test(raw)) return raw;

  let working = stripNamespace(raw);
  working = rewriteFunctionCallsBlocks(working);
  working = rewriteBareInvokeBlocks(working);
  working = stripOrphanTags(working);

  return working;
};
