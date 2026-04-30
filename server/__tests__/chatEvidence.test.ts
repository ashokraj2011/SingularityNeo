// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildStructuredChatEvidencePrompt,
  sanitizeGroundedChatResponse,
} from '../chatEvidence';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map(root =>
      fs.rm(root, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
});

describe('chat evidence guardrails', () => {
  it('renders verified grounding before advisory memory', () => {
    const prompt = buildStructuredChatEvidencePrompt({
      verifiedCodeGrounding: 'Verified symbol evidence here.',
      verifiedRepositoryEvidence: 'Repository root on disk: /tmp/rule-engine',
      advisoryMemory: 'Earlier conversation summary.',
      memoryTrustMode: 'repo-evidence-only',
    });

    expect(prompt.indexOf('Verified code grounding:')).toBeLessThan(
      prompt.indexOf('Advisory memory'),
    );
    expect(prompt).toContain('Do not treat this as proof for repo paths');
  });

  it('strips unsupported location lines from grounded answers', async () => {
    const sanitized = await sanitizeGroundedChatResponse({
      content: [
        '20 operators total across 4 operator types.',
        '',
        'Location:',
        '/src/main/java/com/pzn/ruleengine/operators/',
      ].join('\n'),
      enforceEvidenceOnly: true,
      verifiedPaths: [],
    });

    expect(sanitized.pathValidationState).toBe('stripped');
    expect(sanitized.content).not.toContain('/src/main/java/com/pzn/ruleengine/operators/');
    expect(sanitized.content).toContain(
      'Exact repo path could not be verified from current AST/tool evidence',
    );
  });

  it('keeps verified local checkout paths intact', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-evidence-'));
    tempRoots.push(root);
    const verifiedFile = path.join(root, 'src/main/java/org/example/rules/Operator.java');
    await fs.mkdir(path.dirname(verifiedFile), { recursive: true });
    await fs.writeFile(verifiedFile, 'interface Operator {}', 'utf8');

    const sanitized = await sanitizeGroundedChatResponse({
      content: `Defined in ${verifiedFile}`,
      enforceEvidenceOnly: true,
      checkoutPath: root,
      verifiedPaths: [verifiedFile],
    });

    expect(sanitized.pathValidationState).toBe('verified');
    expect(sanitized.content).toContain(verifiedFile);
    expect(sanitized.unverifiedPathClaimsRemoved).toHaveLength(0);
  });

  it('strips raw internal tool-intent payloads before they reach the UI', async () => {
    const sanitized = await sanitizeGroundedChatResponse({
      content:
        '{"action":"browse_code","reasoning":"Need repo structure.","summary":"Browsing code.","toolCall":{"kind":"class"}}',
      enforceEvidenceOnly: false,
    });

    expect(sanitized.content).toContain(
      'I omitted an internal tool instruction instead of showing it directly.',
    );
  });
});
