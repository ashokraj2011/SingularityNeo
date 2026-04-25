import fs from 'node:fs/promises';
import path from 'node:path';

export type MemoryTrustMode = 'standard' | 'repo-evidence-only';

export type PathValidationState = 'verified' | 'repaired' | 'stripped' | 'none';

export type ChatEvidencePromptArgs = {
  verifiedCodeGrounding?: string | null;
  verifiedRepositoryEvidence?: string | null;
  advisoryMemory?: string | null;
  memoryTrustMode: MemoryTrustMode;
};

type PathClaim = {
  raw: string;
  normalized: string;
  lineIndex: number;
};

const PATH_TOKEN_PATTERN =
  /(?:^|[\s([{"'`])((?:\/|src\/|lib\/|app\/|server\/|client\/|packages\/|modules\/|docs\/)[^\s"'`)<>\]}]+)/g;

const LINE_SUFFIX_PATTERN = /:(\d+)(?:-\d+)?$/;

const normalizePathToken = (token: string) =>
  token
    .trim()
    .replace(/^[("'`[{<]+/, '')
    .replace(/[)"'`\]}>.,;:!?]+$/g, '')
    .replace(LINE_SUFFIX_PATTERN, '')
    .trim();

const isPathLikeToken = (token: string) => {
  if (!token || !token.includes('/')) {
    return false;
  }
  if (/^(https?:|copilot-sdk:|file:)/i.test(token)) {
    return false;
  }
  if (/^[A-Za-z]+\/{2,}/.test(token)) {
    return false;
  }
  return true;
};

const extractPathClaims = (content: string): PathClaim[] => {
  const claims: PathClaim[] = [];
  const lines = String(content || '').split('\n');

  lines.forEach((line, lineIndex) => {
    let match: RegExpExecArray | null;
    PATH_TOKEN_PATTERN.lastIndex = 0;
    while ((match = PATH_TOKEN_PATTERN.exec(line)) !== null) {
      const raw = String(match[1] || '').trim();
      const normalized = normalizePathToken(raw);
      if (!isPathLikeToken(normalized)) {
        continue;
      }
      claims.push({
        raw,
        normalized,
        lineIndex,
      });
    }
  });

  return claims;
};

const lineLooksLikeLocationClaim = (line: string) =>
  /^\s*(location|path|defined in|located in|found in|implementation location)\b/i.test(
    line.trim(),
  );

const lineLooksLikeBarePath = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('/')) {
    return false;
  }
  const withoutPathChars = trimmed.replace(/[A-Za-z0-9_./:-]+/g, '').trim();
  return withoutPathChars.length <= 2;
};

const fileOrDirectoryExists = async (candidatePath: string) => {
  try {
    await fs.stat(candidatePath);
    return true;
  } catch {
    return false;
  }
};

const isVerifiedClaim = async ({
  claim,
  verifiedPaths,
  checkoutPath,
}: {
  claim: string;
  verifiedPaths: Set<string>;
  checkoutPath?: string;
}) => {
  if (verifiedPaths.has(claim)) {
    return true;
  }

  if (checkoutPath) {
    const normalizedRoot = checkoutPath.replace(/\/+$/, '');
    if (claim.startsWith(`${normalizedRoot}/`) || claim === normalizedRoot) {
      return fileOrDirectoryExists(claim);
    }

    if (!path.isAbsolute(claim)) {
      const resolved = path.resolve(normalizedRoot, claim);
      if (
        resolved === normalizedRoot ||
        resolved.startsWith(`${normalizedRoot}${path.sep}`)
      ) {
        return fileOrDirectoryExists(resolved);
      }
    }
  }

  return false;
};

export const buildStructuredChatEvidencePrompt = ({
  verifiedCodeGrounding,
  verifiedRepositoryEvidence,
  advisoryMemory,
  memoryTrustMode,
}: ChatEvidencePromptArgs) => {
  const sections = [
    verifiedCodeGrounding?.trim()
      ? `Verified code grounding:\n${verifiedCodeGrounding.trim()}`
      : null,
    verifiedRepositoryEvidence?.trim()
      ? `Verified repository/tool evidence:\n${verifiedRepositoryEvidence.trim()}`
      : null,
    advisoryMemory?.trim()
      ? [
          `Advisory memory (${memoryTrustMode}):`,
          'Do not treat this as proof for repo paths, symbol locations, or exact code counts.',
          advisoryMemory.trim(),
        ].join('\n')
      : null,
  ].filter(Boolean);

  return sections.join('\n\n');
};

export const sanitizeGroundedChatResponse = async ({
  content,
  checkoutPath,
  verifiedPaths,
  enforceEvidenceOnly,
}: {
  content: string;
  checkoutPath?: string;
  verifiedPaths?: string[];
  enforceEvidenceOnly: boolean;
}): Promise<{
  content: string;
  pathValidationState: PathValidationState;
  unverifiedPathClaimsRemoved: string[];
}> => {
  if (!enforceEvidenceOnly) {
    return {
      content,
      pathValidationState: 'none',
      unverifiedPathClaimsRemoved: [],
    };
  }

  const claims = extractPathClaims(content);
  if (claims.length === 0) {
    return {
      content,
      pathValidationState: 'none',
      unverifiedPathClaimsRemoved: [],
    };
  }

  const verifiedPathSet = new Set(
    (verifiedPaths || [])
      .map(value => normalizePathToken(String(value || '')))
      .filter(Boolean),
  );
  const unverifiedClaims: PathClaim[] = [];

  for (const claim of claims) {
    const verified = await isVerifiedClaim({
      claim: claim.normalized,
      verifiedPaths: verifiedPathSet,
      checkoutPath,
    });
    if (!verified) {
      unverifiedClaims.push(claim);
    }
  }

  if (unverifiedClaims.length === 0) {
    return {
      content,
      pathValidationState: 'verified',
      unverifiedPathClaimsRemoved: [],
    };
  }

  const groupedClaims = new Map<number, PathClaim[]>();
  unverifiedClaims.forEach(claim => {
    const existing = groupedClaims.get(claim.lineIndex) || [];
    existing.push(claim);
    groupedClaims.set(claim.lineIndex, existing);
  });

  let lineWasRemoved = false;
  const updatedLines = String(content || '')
    .split('\n')
    .flatMap((line, lineIndex) => {
      const claimsForLine = groupedClaims.get(lineIndex);
      if (!claimsForLine?.length) {
        return [line];
      }

      if (lineLooksLikeLocationClaim(line) || lineLooksLikeBarePath(line)) {
        lineWasRemoved = true;
        return [];
      }

      let repaired = line;
      claimsForLine.forEach(claim => {
        repaired = repaired.replaceAll(
          claim.raw,
          'exact path omitted because it could not be verified from current repo evidence',
        );
      });
      return [repaired];
    });

  const disclaimer =
    'Exact repo path could not be verified from current AST/tool evidence, so location details were omitted.';
  const repairedContent = updatedLines.join('\n').trim();
  const nextContent = repairedContent.includes(disclaimer)
    ? repairedContent
    : [repairedContent, disclaimer].filter(Boolean).join('\n\n');

  return {
    content: nextContent,
    pathValidationState: lineWasRemoved ? 'stripped' : 'repaired',
    unverifiedPathClaimsRemoved: [...new Set(unverifiedClaims.map(claim => claim.normalized))],
  };
};
