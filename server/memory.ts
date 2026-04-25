import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { PoolClient } from 'pg';
import type {
  Capability,
  CapabilityWorkspace,
  EmbeddingProviderKey,
  MemoryChunk,
  MemoryDocument,
  MemoryReference,
  MemorySearchResult,
  MemorySourceType,
  MemoryStoreTier,
} from '../src/types';
import {
  getMemoryRetrievalDiagnostics,
  getPlatformFeatureState,
  query,
  transaction,
} from './db';
import { getCapabilityBundle } from './repository';
import { getAgentLearningProfile, queueAgentLearningJob } from './agentLearning/repository';
import {
  executionRuntimeRpc,
  isRemoteExecutionClient,
} from './execution/runtimeClient';
import { getCapabilityWorkspaceRoots } from './workspacePaths';
import { requestLocalOpenAIEmbeddings } from './localOpenAIProvider';
import {
  DEFAULT_EMBEDDING_PROVIDER_KEY,
  HASH_EMBEDDING_PROVIDER_KEY,
} from './providerRegistry';
import {
  buildBudgetedMemoryPrompt,
  resolveTokenOptimizationPolicy,
} from './tokenOptimization';
import { getWorkspaceFileIndex } from './workspaceIndex';

const EMBEDDING_DIMENSIONS = getPlatformFeatureState().memoryEmbeddingDimensions;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'memory';

const approxTokenEstimate = (value: string) =>
  Math.max(12, Math.ceil(value.trim().split(/\s+/).length * 1.35));

const normalizeText = (value: string) =>
  value
    .replace(/\0/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const splitIntoChunks = (content: string, limit = 900) => {
  const normalized = normalizeText(content);
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/).map(section => section.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > limit && current) {
      chunks.push(current);
      current = paragraph;
      continue;
    }

    if (paragraph.length > limit) {
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        const next = current ? `${current} ${sentence}` : sentence;
        if (next.length > limit && current) {
          chunks.push(current);
          current = sentence;
        } else {
          current = next;
        }
      }
      continue;
    }

    current = candidate;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

type QueryExecutor = Pick<PoolClient, 'query'>;

type MemoryRefreshChunkPlan = {
  id: string;
  embeddingId: string;
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
  metadata: Record<string, any>;
  embedding: number[];
};

type MemoryRefreshDocumentPlan = {
  capabilityId: string;
  id: string;
  title: string;
  sourceType: MemorySourceType;
  tier: MemoryStoreTier;
  sourceId?: string;
  sourceUri?: string;
  freshness?: MemoryDocument['freshness'];
  metadata?: Record<string, any>;
  contentPreview: string;
  vectorModel: string;
  embeddingProviderKey: EmbeddingProviderKey;
  embeddingFallbackReason?: string;
  embeddingInputCount: number;
  embeddingVectorCount: number;
  chunks: MemoryRefreshChunkPlan[];
};

type MemorySourceSeed = {
  id: string;
  title: string;
  sourceType: MemorySourceType;
  tier: MemoryStoreTier;
  sourceUri?: string;
  sourceId?: string;
  metadata?: Record<string, any>;
  content: string;
};

const MANAGED_MEMORY_SOURCE_TYPES: MemorySourceType[] = [
  'CAPABILITY_METADATA',
  'ARTIFACT',
  'HANDOFF',
  'HUMAN_INTERACTION',
  'WORK_ITEM',
  'CHAT_SESSION',
  'REPOSITORY_FILE',
];

const queryWithExecutor = <T = unknown>(
  executor: QueryExecutor,
  text: string,
  params?: unknown[],
) => executor.query<T>(text, params);

const buildStableMemoryRowId = (
  prefix: 'MEMCHUNK' | 'MEMEMBED',
  capabilityId: string,
  documentId: string,
  chunkIndex: number,
) =>
  `${prefix}-${createHash('sha1')
    .update(`${capabilityId}:${documentId}:${chunkIndex}:${prefix}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase()}`;

const compareStrings = (left?: string, right?: string) =>
  String(left || '').localeCompare(String(right || ''));

const hashEmbedText = (content: string) => {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const tokens = normalizeText(content)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 1);

  tokens.forEach((token, tokenIndex) => {
    let hash = 0;
    for (const character of token) {
      hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    }
    const index = hash % EMBEDDING_DIMENSIONS;
    vector[index] += 1 + ((tokenIndex % 5) * 0.1);
  });

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0)) || 1;
  return vector.map(value => Number((value / magnitude).toFixed(6)));
};

const tokenize = (value: string) =>
  normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 1);

const lexicalOverlapScore = (queryText: string, content: string) => {
  const queryTokens = new Set(tokenize(queryText));
  if (queryTokens.size === 0) {
    return 0;
  }

  const contentTokens = new Set(tokenize(content));
  let hits = 0;
  queryTokens.forEach(token => {
    if (contentTokens.has(token)) {
      hits += 1;
    }
  });
  return hits / Math.max(queryTokens.size, 1);
};

const getSourceBoost = (document: MemoryDocument) => {
  switch (document.sourceType) {
    case 'ARTIFACT':
    case 'HANDOFF':
      return 0.08;
    case 'HUMAN_INTERACTION':
      return 0.06;
    case 'WORK_ITEM':
      return 0.04;
    case 'CAPABILITY_METADATA':
      return 0.03;
    default:
      return 0;
  }
};

const embedTexts = async (
  texts: string[],
  options?: {
    suppressFallbackLog?: boolean;
    fallbackLogContext?: string;
  },
): Promise<{
  providerKey: EmbeddingProviderKey;
  model: string;
  vectors: number[][];
  fallbackReason?: string;
}> => {
  const response = await requestLocalOpenAIEmbeddings({
    texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  if (
    response.providerKey === DEFAULT_EMBEDDING_PROVIDER_KEY &&
    response.vectors.length === texts.length
  ) {
    return response;
  }

  const fallbackReason =
    response.providerKey !== DEFAULT_EMBEDDING_PROVIDER_KEY
      ? response.fallbackReason ||
        'Embedding provider fell back to deterministic hash embeddings.'
      : `Embedding provider returned ${response.vectors.length} vectors for ${texts.length} texts.`;
  if (!options?.suppressFallbackLog) {
    const contextPrefix = options?.fallbackLogContext ? `${options.fallbackLogContext}: ` : '';
    console.warn(`[memory] ${contextPrefix}${fallbackReason}`);
  }

  return {
    providerKey: HASH_EMBEDDING_PROVIDER_KEY,
    model: 'deterministic-hash-v2',
    vectors: texts.map(text => hashEmbedText(text)),
    fallbackReason,
  };
};

const serializeVector = (values: number[]) => `[${values.join(',')}]`;

const cosineSimilarity = (left: number[], right: number[]) => {
  if (!left.length || !right.length || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }

  const magnitude = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude) || 1;
  return dot / magnitude;
};

const resolveMemorySearchDiagnostics = ({
  embeddingProviderKey,
  fallbackReason,
}: {
  embeddingProviderKey: EmbeddingProviderKey;
  fallbackReason?: string;
}) => {
  const baseline = getMemoryRetrievalDiagnostics();
  if (embeddingProviderKey === HASH_EMBEDDING_PROVIDER_KEY) {
    return {
      retrievalMode: 'deterministic-hash' as const,
      pgvectorAvailable: getPlatformFeatureState().pgvectorAvailable,
      embeddingConfigured: baseline.embeddingConfigured,
      embeddingProviderKey,
      fallbackReason:
        fallbackReason || baseline.fallbackReason || 'Using deterministic hash retrieval fallback.',
    };
  }
  return {
    retrievalMode: baseline.retrievalMode,
    pgvectorAvailable: getPlatformFeatureState().pgvectorAvailable,
    embeddingConfigured: baseline.embeddingConfigured,
    embeddingProviderKey,
    fallbackReason: fallbackReason || baseline.fallbackReason,
  };
};

const scoreMemoryCandidate = ({
  queryText,
  queryEmbedding,
  document,
  content,
  embedding,
}: {
  queryText: string;
  queryEmbedding: number[];
  document: MemoryDocument;
  content: string;
  embedding: number[];
}) => {
  const semanticScore = cosineSimilarity(queryEmbedding, embedding);
  const lexicalScore = lexicalOverlapScore(queryText, content);
  const rerankScore =
    semanticScore * 0.72 + lexicalScore * 0.24 + getSourceBoost(document);

  return {
    semanticScore,
    lexicalScore,
    rerankScore,
    retrievalMethod: lexicalScore > 0 ? 'BLENDED' : 'SEMANTIC',
  } as const;
};

const documentFromRow = (row: Record<string, any>): MemoryDocument => ({
  id: row.id,
  capabilityId: row.capability_id,
  title: row.title,
  sourceType: row.source_type,
  tier: row.tier,
  sourceId: row.source_id || undefined,
  sourceUri: row.source_uri || undefined,
  freshness: row.freshness || undefined,
  metadata: row.metadata || undefined,
  contentPreview: row.content_preview,
  isGlobal: Boolean(row.is_global),
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
});

const chunkFromRow = (row: Record<string, any>): MemoryChunk => ({
  id: row.chunk_id || row.id,
  capabilityId: row.capability_id,
  documentId: row.document_id,
  chunkIndex: Number(row.chunk_index || 0),
  content: row.content,
  tokenEstimate: Number(row.token_estimate || 0),
  metadata: row.chunk_metadata || row.metadata || undefined,
  createdAt: row.chunk_created_at instanceof Date ? row.chunk_created_at.toISOString() : String(row.chunk_created_at || row.created_at),
});

const createMemoryDocumentId = (
  capabilityId: string,
  sourceType: MemorySourceType,
  sourceId: string,
) => `MEMDOC-${slugify(`${capabilityId}-${sourceType}-${sourceId}`)}`.toUpperCase();

const replaceDocumentChunksTx = async ({
  executor,
  capabilityId,
  documentId,
  vectorModel,
  chunks,
}: {
  executor: QueryExecutor;
  capabilityId: string;
  documentId: string;
  vectorModel: string;
  chunks: MemoryRefreshChunkPlan[];
}) => {
  await queryWithExecutor(
    executor,
    'DELETE FROM capability_memory_chunks WHERE capability_id = $1 AND document_id = $2',
    [capabilityId, documentId],
  );
  await queryWithExecutor(
    executor,
    'DELETE FROM capability_memory_embeddings WHERE capability_id = $1 AND document_id = $2',
    [capabilityId, documentId],
  );

  for (const chunk of chunks) {
    await queryWithExecutor(
      executor,
      `
        INSERT INTO capability_memory_chunks (
          capability_id,
          id,
          document_id,
          chunk_index,
          content,
          token_estimate,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        capabilityId,
        chunk.id,
        documentId,
        chunk.chunkIndex,
        chunk.content,
        chunk.tokenEstimate,
        chunk.metadata,
      ],
    );
    await queryWithExecutor(
      executor,
      `
        INSERT INTO capability_memory_embeddings (
          capability_id,
          id,
          document_id,
          chunk_id,
          vector_model,
          embedding_json,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,NOW())
      `,
      [
        capabilityId,
        chunk.embeddingId,
        documentId,
        chunk.id,
        vectorModel,
        JSON.stringify(chunk.embedding),
      ],
    );

    if (getPlatformFeatureState().pgvectorAvailable) {
      await queryWithExecutor(
        executor,
        `
          UPDATE capability_memory_embeddings
          SET embedding_vector = $3::vector
          WHERE capability_id = $1 AND id = $2
        `,
        [capabilityId, chunk.embeddingId, serializeVector(chunk.embedding)],
      );
    }
  }
};

const upsertMemoryDocument = async ({
  executor,
  capabilityId,
  id,
  title,
  sourceType,
  tier,
  sourceId,
  sourceUri,
  freshness,
  metadata,
  contentPreview,
  isGlobal,
  vectorModel,
  chunks,
}: {
  executor: QueryExecutor;
  capabilityId: string;
  id: string;
  title: string;
  sourceType: MemorySourceType;
  tier: MemoryStoreTier;
  sourceId?: string;
  sourceUri?: string;
  freshness?: MemoryDocument['freshness'];
  metadata?: Record<string, any>;
  contentPreview: string;
  /** When true, this document is visible to every capability (global memory). */
  isGlobal?: boolean;
  vectorModel: string;
  chunks: MemoryRefreshChunkPlan[];
}) => {
  await queryWithExecutor(
    executor,
    `
      INSERT INTO capability_memory_documents (
        capability_id,
        id,
        title,
        source_type,
        tier,
        source_id,
        source_uri,
        freshness,
        metadata,
        content_preview,
        is_global,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      ON CONFLICT (capability_id, id) DO UPDATE SET
        title = EXCLUDED.title,
        source_type = EXCLUDED.source_type,
        tier = EXCLUDED.tier,
        source_id = EXCLUDED.source_id,
        source_uri = EXCLUDED.source_uri,
        freshness = EXCLUDED.freshness,
        metadata = EXCLUDED.metadata,
        content_preview = EXCLUDED.content_preview,
        is_global = EXCLUDED.is_global,
        updated_at = NOW()
    `,
    [
      capabilityId,
      id,
      title,
      sourceType,
      tier,
      sourceId || null,
      sourceUri || null,
      freshness || null,
      metadata || {},
      contentPreview,
      Boolean(isGlobal),
    ],
  );

  await replaceDocumentChunksTx({
    executor,
    capabilityId,
    documentId: id,
    vectorModel,
    chunks,
  });
};

const buildCapabilityMetadataContent = (capability: Capability) =>
  [
    `Capability: ${capability.name}`,
    capability.description,
    capability.domain ? `Domain: ${capability.domain}` : null,
    capability.businessUnit ? `Business unit: ${capability.businessUnit}` : null,
    capability.ownerTeam ? `Owner team: ${capability.ownerTeam}` : null,
    capability.teamNames.length ? `Associated teams: ${capability.teamNames.join(', ')}` : null,
    capability.databaseConfigs?.length
      ? `Database profiles: ${capability.databaseConfigs
          .map(config =>
            [
              config.label || config.databaseName,
              config.engine,
              config.host,
              config.port,
              config.databaseName,
              config.schema,
              config.secretReference ? `secret=${config.secretReference}` : null,
            ]
              .filter(Boolean)
              .join(' | '),
          )
          .join('; ')}`
      : null,
    capability.gitRepositories.length ? `Git repositories: ${capability.gitRepositories.join(', ')}` : null,
    capability.executionConfig.defaultWorkspacePath
      ? `Default workspace path: ${capability.executionConfig.defaultWorkspacePath}`
      : null,
    capability.executionConfig.allowedWorkspacePaths.length
      ? `Legacy workspace hints: ${capability.executionConfig.allowedWorkspacePaths.join(', ')}`
      : null,
    capability.localDirectories.length ? `Local directories: ${capability.localDirectories.join(', ')}` : null,
    capability.documentationNotes ? `Documentation notes: ${capability.documentationNotes}` : null,
    capability.stakeholders.length
      ? `Stakeholders: ${capability.stakeholders
          .map(stakeholder =>
            [stakeholder.role, stakeholder.name, stakeholder.email].filter(Boolean).join(' | '),
          )
          .join('; ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

const buildSources = (
  capability: Capability,
  workspace: CapabilityWorkspace,
): MemorySourceSeed[] => {
  const sources: MemorySourceSeed[] = [
    {
      id: createMemoryDocumentId(capability.id, 'CAPABILITY_METADATA', capability.id),
      title: `${capability.name} Capability Profile`,
      sourceType: 'CAPABILITY_METADATA',
      tier: 'LONG_TERM',
      sourceId: capability.id,
      metadata: {
        capabilityId: capability.id,
      },
      content: buildCapabilityMetadataContent(capability),
    },
  ];

  workspace.artifacts.forEach(artifact => {
    const isHumanInteraction =
      artifact.artifactKind === 'INPUT_NOTE' ||
      artifact.artifactKind === 'STAGE_CONTROL_NOTE' ||
      artifact.artifactKind === 'CONFLICT_RESOLUTION' ||
      artifact.artifactKind === 'APPROVAL_RECORD';
    const sourceType: MemorySourceType = isHumanInteraction
      ? 'HUMAN_INTERACTION'
      : artifact.artifactKind === 'HANDOFF_PACKET'
      ? 'HANDOFF'
      : 'ARTIFACT';

    sources.push({
      id: createMemoryDocumentId(capability.id, sourceType, artifact.id),
      title: artifact.name,
      sourceType,
      tier:
        artifact.artifactKind === 'INPUT_NOTE' ||
        artifact.artifactKind === 'STAGE_CONTROL_NOTE' ||
        artifact.artifactKind === 'CONFLICT_RESOLUTION'
          ? 'SESSION'
          : artifact.artifactKind === 'APPROVAL_RECORD'
          ? 'LONG_TERM'
          : artifact.artifactKind === 'CONTRARIAN_REVIEW'
          ? 'LONG_TERM'
          : 'LONG_TERM',
      sourceId: artifact.id,
      metadata: {
        artifactId: artifact.id,
        workItemId: artifact.workItemId,
        phase: artifact.phase,
        traceId: artifact.traceId,
        artifactKind: artifact.artifactKind,
        sourceRunId: artifact.sourceRunId || artifact.runId,
        sourceRunStepId: artifact.sourceRunStepId || artifact.runStepId,
        handoffFromAgentId: artifact.handoffFromAgentId,
        handoffToAgentId: artifact.handoffToAgentId,
      },
      content:
        artifact.contentText ||
        artifact.summary ||
        artifact.description ||
        `${artifact.name} generated during ${artifact.phase || 'workflow execution'}.`,
    });
  });

  workspace.workItems.forEach(item => {
    sources.push({
      id: createMemoryDocumentId(capability.id, 'WORK_ITEM', item.id),
      title: item.title,
      sourceType: 'WORK_ITEM',
      tier: item.status === 'COMPLETED' ? 'LONG_TERM' : 'WORKING',
      sourceId: item.id,
      metadata: {
        workItemId: item.id,
        phase: item.phase,
        status: item.status,
      },
      content: [
        `Title: ${item.title}`,
        `Description: ${item.description}`,
        `Phase: ${item.phase}`,
        `Status: ${item.status}`,
        item.history.length
          ? `Recent history:\n${item.history
              .slice(-8)
              .map(entry => `${entry.action}: ${entry.detail}`)
              .join('\n')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  });

  const recentMessages = workspace.messages.slice(-12);
  if (recentMessages.length > 0) {
    const recentUserMessages = recentMessages
      .filter(message => String(message.role || '').toLowerCase() === 'user')
      .slice(-8);
    sources.push({
      id: createMemoryDocumentId(capability.id, 'CHAT_SESSION', `${capability.id}-session`),
      title: `${capability.name} Recent Chat Session`,
      sourceType: 'CHAT_SESSION',
      tier: 'SESSION',
      sourceId: `${capability.id}-session`,
      metadata: {
        messageCount: recentMessages.length,
        userMessageCount: recentUserMessages.length,
      },
      content: [
        `Recent user requests from the ${capability.name} chat session.`,
        'This session memory is advisory only and must not be used as proof for repository paths, symbol locations, or exact code counts.',
        recentUserMessages.length > 0
          ? recentUserMessages
              .map(message => `USER: ${message.content}`)
              .join('\n\n')
          : 'No recent user prompts were available for chat-session memory.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
  }

  return sources;
};

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.py',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
]);

const buildRepositoryFileScore = (relativePath: string) => {
  const fileName = path.basename(relativePath);
  const extension = path.extname(fileName).toLowerCase();
  const isReadme = /^readme/i.test(fileName);
  const isDocPath = relativePath.startsWith('docs/');
  const isConfig =
    fileName === 'package.json' ||
    fileName === 'pyproject.toml' ||
    fileName === 'requirements.txt' ||
    fileName === 'setup.py' ||
    fileName === 'Pipfile' ||
    fileName === 'pytest.ini' ||
    fileName === 'tox.ini' ||
    fileName === 'tsconfig.json' ||
    fileName.endsWith('.config.ts') ||
    fileName.endsWith('.config.js');

  if (!(isReadme || isDocPath || isConfig || TEXT_EXTENSIONS.has(extension))) {
    return -1;
  }

  let score = 10;
  if (isReadme) score += 50;
  if (isDocPath) score += 30;
  if (isConfig) score += 20;
  if (/artifact|workflow|design|requirement|runbook|architecture/i.test(relativePath)) {
    score += 12;
  }

  return score;
};

const buildRepositoryFileSources = async (
  capability: Capability,
): Promise<MemorySourceSeed[]> => {
  const repoSources: MemorySourceSeed[] = [];

  for (const directoryPath of [...getCapabilityWorkspaceRoots(capability)].sort(compareStrings)) {
    const indexedFiles = await getWorkspaceFileIndex(directoryPath, {
      maxFiles: 5_000,
    }).catch(() => []);
    const candidateFiles = indexedFiles
      .map(relativePath => ({
        absolutePath: path.join(directoryPath, relativePath),
        relativePath,
        score: buildRepositoryFileScore(relativePath),
      }))
      .filter(file => file.score >= 0)
      .sort((left, right) => right.score - left.score || compareStrings(left.relativePath, right.relativePath))
      .slice(0, 120);

    for (const file of candidateFiles) {
      try {
        const stat = fs.statSync(file.absolutePath);
        if (stat.size > 120_000) {
          continue;
        }
        const content = fs.readFileSync(file.absolutePath, 'utf8').trim();
        if (!content) {
          continue;
        }

        const sourceId = `${directoryPath}:${file.relativePath}`;
        repoSources.push({
          id: createMemoryDocumentId(capability.id, 'REPOSITORY_FILE', sourceId),
          title: `Repository File · ${file.relativePath}`,
          sourceType: 'REPOSITORY_FILE',
          tier: 'LONG_TERM',
          sourceUri: file.absolutePath,
          sourceId,
          metadata: {
            path: file.absolutePath,
            relativePath: file.relativePath,
            workspacePath: directoryPath,
          },
          content,
        });
      } catch {
        // Ignore unreadable repository files.
      }
    }
  }

  return repoSources;
};

const buildMemorySourceRefreshId = (source: MemorySourceSeed) =>
  source.sourceId ||
  source.metadata?.artifactId ||
  source.metadata?.workItemId ||
  source.metadata?.capabilityId ||
  source.id;

const buildMemorySourceFreshness = (
  tier: MemoryStoreTier,
): MemoryDocument['freshness'] => {
  if (tier === 'WORKING') {
    return 'HOT';
  }
  if (tier === 'SESSION') {
    return 'WARM';
  }
  return 'COLD';
};

const buildMemoryDocumentMetadata = ({
  source,
  vectorModel,
  embeddingProviderKey,
  embeddingFallbackReason,
  normalizedContent,
}: {
  source: MemorySourceSeed;
  vectorModel: string;
  embeddingProviderKey: EmbeddingProviderKey;
  embeddingFallbackReason?: string;
  normalizedContent: string;
}) => ({
  ...(source.metadata || {}),
  memoryEmbedding: {
    providerKey: embeddingProviderKey,
    vectorModel,
    fallbackReason: embeddingFallbackReason || null,
    contentLength: normalizedContent.length,
  },
});

const buildMemoryRefreshDocumentPlan = async ({
  capabilityId,
  source,
}: {
  capabilityId: string;
  source: MemorySourceSeed;
}): Promise<MemoryRefreshDocumentPlan> => {
  const normalizedContent = normalizeText(source.content);
  const chunkContents = splitIntoChunks(normalizedContent);
  const embeddingResult = await embedTexts(chunkContents, {
    suppressFallbackLog: true,
  });

  const chunks = chunkContents.map((content, chunkIndex) => ({
    id: buildStableMemoryRowId('MEMCHUNK', capabilityId, source.id, chunkIndex),
    embeddingId: buildStableMemoryRowId('MEMEMBED', capabilityId, source.id, chunkIndex),
    chunkIndex,
    content,
    tokenEstimate: approxTokenEstimate(content),
    metadata: {
      sourceType: source.sourceType,
      sourceId: buildMemorySourceRefreshId(source),
      relativePath: source.metadata?.relativePath,
      workspacePath: source.metadata?.workspacePath,
    },
    embedding: embeddingResult.vectors[chunkIndex] || hashEmbedText(content),
  }));

  return {
    capabilityId,
    id: source.id,
    title: source.title,
    sourceType: source.sourceType,
    tier: source.tier,
    sourceId: buildMemorySourceRefreshId(source),
    sourceUri: source.sourceUri,
    freshness: buildMemorySourceFreshness(source.tier),
    metadata: buildMemoryDocumentMetadata({
      source,
      vectorModel: embeddingResult.model,
      embeddingProviderKey: embeddingResult.providerKey,
      embeddingFallbackReason: embeddingResult.fallbackReason,
      normalizedContent,
    }),
    contentPreview: normalizedContent.slice(0, 2_000),
    vectorModel: embeddingResult.model,
    embeddingProviderKey: embeddingResult.providerKey,
    embeddingFallbackReason: embeddingResult.fallbackReason,
    embeddingInputCount: chunkContents.length,
    embeddingVectorCount: embeddingResult.vectors.length,
    chunks,
  };
};

const buildMemoryRefreshPlan = async ({
  capabilityId,
  sources,
}: {
  capabilityId: string;
  sources: MemorySourceSeed[];
}) =>
  Promise.all(
    [...sources]
      .sort((left, right) => compareStrings(left.id, right.id))
      .map(source =>
        buildMemoryRefreshDocumentPlan({
          capabilityId,
          source,
        }),
      ),
  );

export const buildMemoryEmbeddingRefreshSummary = ({
  capabilityId,
  documents,
}: {
  capabilityId: string;
  documents: MemoryRefreshDocumentPlan[];
}) => {
  const fallbackDocuments = documents.filter(document => document.embeddingFallbackReason);
  if (fallbackDocuments.length === 0) {
    return null;
  }

  const reasonCounts = new Map<string, number>();
  const sourceTypeCounts = new Map<MemorySourceType, number>();
  let mismatchCount = 0;

  fallbackDocuments.forEach(document => {
    const reason =
      String(document.embeddingFallbackReason || '')
        .trim()
        .replace(/[.]+$/g, '') || 'Embedding fallback';
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    sourceTypeCounts.set(
      document.sourceType,
      (sourceTypeCounts.get(document.sourceType) || 0) + 1,
    );
    if (document.embeddingInputCount !== document.embeddingVectorCount) {
      mismatchCount += 1;
    }
  });

  const reasonSummary = [...reasonCounts.entries()]
    .sort((left, right) => right[1] - left[1] || compareStrings(left[0], right[0]))
    .map(([reason, count]) => `${count}x ${reason}.`)
    .join('; ');
  const sourceSummary = [...sourceTypeCounts.entries()]
    .sort((left, right) => right[1] - left[1] || compareStrings(left[0], right[0]))
    .map(([sourceType, count]) => `${sourceType}: ${count}`)
    .join(', ');
  const mismatchSummary =
    mismatchCount > 0
      ? ` ${mismatchCount} document${mismatchCount === 1 ? '' : 's'} also received mismatched vector counts and were normalized with deterministic hash embeddings.`
      : '';
  const configHint = /not configured/i.test(reasonSummary)
    ? ' Set LOCAL_OPENAI_BASE_URL (or OPENAI_COMPAT_BASE_URL) to enable semantic embeddings.'
    : '';

  return `[memory] ${capabilityId}: ${fallbackDocuments.length}/${documents.length} memory documents used deterministic hash embeddings during refresh. Sources: ${sourceSummary}. Reasons: ${reasonSummary}${mismatchSummary}${configHint}`;
};

const deleteStaleManagedMemoryDocumentsTx = async ({
  executor,
  capabilityId,
  activeDocumentIds,
}: {
  executor: QueryExecutor;
  capabilityId: string;
  activeDocumentIds: string[];
}) => {
  await queryWithExecutor(
    executor,
    `
      DELETE FROM capability_memory_documents
      WHERE capability_id = $1
        AND source_type = ANY($2::text[])
        AND NOT (id = ANY($3::text[]))
    `,
    [capabilityId, MANAGED_MEMORY_SOURCE_TYPES, activeDocumentIds],
  );
};

const applyMemoryRefreshPlanTx = async ({
  executor,
  capabilityId,
  documents,
}: {
  executor: QueryExecutor;
  capabilityId: string;
  documents: MemoryRefreshDocumentPlan[];
}) => {
  for (const document of documents) {
    await upsertMemoryDocument({
      executor,
      capabilityId,
      id: document.id,
      title: document.title,
      sourceType: document.sourceType,
      tier: document.tier,
      sourceId: document.sourceId,
      sourceUri: document.sourceUri,
      freshness: document.freshness,
      metadata: document.metadata,
      contentPreview: document.contentPreview,
      vectorModel: document.vectorModel,
      chunks: document.chunks,
    });
  }

  await deleteStaleManagedMemoryDocumentsTx({
    executor,
    capabilityId,
    activeDocumentIds: documents.map(document => document.id),
  });
};

const getAgentSourceFilter = async (capabilityId: string, agentId?: string) => {
  if (!agentId) {
    return null;
  }

  const profile = await getAgentLearningProfile(capabilityId, agentId);
  if (!profile.sourceDocumentIds.length) {
    return null;
  }

  return new Set(profile.sourceDocumentIds);
};

export const refreshCapabilityMemory = async (
  capabilityId: string,
  options?: { requeueAgents?: boolean; requestReason?: string },
) => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<MemoryDocument[]>('refreshCapabilityMemory', {
      capabilityId,
    });
  }

  const bundle = await getCapabilityBundle(capabilityId);
  const sources = [
    ...buildSources(bundle.capability, bundle.workspace),
    ...(await buildRepositoryFileSources(bundle.capability)),
  ];
  const refreshPlan = await buildMemoryRefreshPlan({
    capabilityId,
    sources,
  });
  const refreshFallbackSummary = buildMemoryEmbeddingRefreshSummary({
    capabilityId,
    documents: refreshPlan,
  });
  if (refreshFallbackSummary) {
    console.warn(refreshFallbackSummary);
  }

  await transaction(async executor => {
    await applyMemoryRefreshPlanTx({
      executor,
      capabilityId,
      documents: refreshPlan,
    });
  });

  if (options?.requeueAgents !== false) {
    await Promise.all(
      bundle.workspace.agents.map(agent =>
        queueAgentLearningJob({
          capabilityId,
          agentId: agent.id,
          requestReason: options?.requestReason || 'memory-refresh',
          makeStale: true,
        }).catch(() => undefined),
      ),
    );
  }

  return listMemoryDocuments(capabilityId);
};

export const listMemoryDocuments = async (
  capabilityId: string,
  agentId?: string,
) => {
  const sourceFilter = await getAgentSourceFilter(capabilityId, agentId);
  const result = await query(
    `
      SELECT *
      FROM capability_memory_documents
      WHERE (capability_id = $1 OR is_global = TRUE)
      ORDER BY updated_at DESC, id DESC
    `,
    [capabilityId],
  );

  return result.rows
    .map(documentFromRow)
    .filter(document => {
      // Global documents are visible to all — bypass the per-agent filter.
      if (document.isGlobal) {
        return true;
      }
      if (sourceFilter === null) {
        return true;
      }
      if (sourceFilter.size === 0) {
        return false;
      }
      return sourceFilter.has(document.id);
    });
};

export const searchCapabilityMemory = async ({
  capabilityId,
  agentId,
  queryText,
  limit = 8,
  excludeSourceTypes = [],
}: {
  capabilityId: string;
  agentId?: string;
  queryText: string;
  limit?: number;
  excludeSourceTypes?: MemorySourceType[];
}): Promise<MemorySearchResult[]> => {
  const normalizedQuery = normalizeText(queryText);
  if (!normalizedQuery) {
    return [];
  }
  const excludedSourceTypes = new Set(excludeSourceTypes);
  const sourceFilter = await getAgentSourceFilter(capabilityId, agentId);
  if (sourceFilter && sourceFilter.size === 0) {
    return [];
  }

  const queryEmbeddingResult = await embedTexts([normalizedQuery]);
  const queryEmbedding =
    queryEmbeddingResult.vectors[0] || hashEmbedText(normalizedQuery);

  const result = await query(
    `
      SELECT
        docs.*,
        chunks.id AS chunk_id,
        chunks.chunk_index,
        chunks.content,
        chunks.token_estimate,
        chunks.metadata AS chunk_metadata,
        chunks.created_at AS chunk_created_at,
        embeddings.embedding_json,
        embeddings.vector_model
      FROM capability_memory_documents docs
      JOIN capability_memory_chunks chunks
        ON chunks.capability_id = docs.capability_id
       AND chunks.document_id = docs.id
      JOIN capability_memory_embeddings embeddings
        ON embeddings.capability_id = chunks.capability_id
       AND embeddings.chunk_id = chunks.id
      WHERE (docs.capability_id = $1 OR docs.is_global = TRUE)
      ORDER BY docs.updated_at DESC, chunks.chunk_index ASC
    `,
    [capabilityId],
  );

  return result.rows
    .map(row => {
      const record = row as Record<string, any>;
      const embedding = Array.isArray(record.embedding_json)
        ? record.embedding_json.map((value: unknown) => Number(value || 0))
        : [];
      const document = documentFromRow(record);
      const chunk = chunkFromRow(record);
      const score = scoreMemoryCandidate({
        queryText: normalizedQuery,
        queryEmbedding,
        document,
        content: `${document.title}\n${document.contentPreview}\n${chunk.content}`,
        embedding,
      });
      const diagnostics = resolveMemorySearchDiagnostics({
        embeddingProviderKey: queryEmbeddingResult.providerKey,
        fallbackReason: queryEmbeddingResult.fallbackReason,
      });

      return {
        reference: {
          documentId: document.id,
          chunkId: chunk.id,
          title: document.title,
          sourceType: document.sourceType,
          tier: document.tier,
          score: score.rerankScore,
          retrievalMethod: score.retrievalMethod,
          semanticScore: score.semanticScore,
          lexicalScore: score.lexicalScore,
          rerankScore: score.rerankScore,
        } satisfies MemoryReference,
        document,
        chunk,
        embeddingProviderKey: diagnostics.embeddingProviderKey,
        embeddingConfigured: diagnostics.embeddingConfigured,
        retrievalMode: diagnostics.retrievalMode,
        pgvectorAvailable: diagnostics.pgvectorAvailable,
        fallbackReason: diagnostics.fallbackReason,
        vectorModel: String(record.vector_model || queryEmbeddingResult.model || ''),
      };
    })
    .filter(item => !excludedSourceTypes.has(item.document.sourceType))
    .sort((left, right) => (right.reference.rerankScore || 0) - (left.reference.rerankScore || 0))
    .filter(item => {
      // Global documents bypass per-agent source filters — they are
      // intentionally visible to every capability and agent.
      if (item.document.isGlobal) {
        return true;
      }
      if (sourceFilter === null) {
        return true;
      }
      return sourceFilter.has(item.document.id);
    })
    .slice(0, limit);
};

export const rankMemoryCorpusByQuery = async ({
  corpus,
  queryText,
}: {
  corpus: Awaited<ReturnType<typeof getCapabilityMemoryCorpus>>;
  queryText: string;
}) => {
  const normalizedQuery = normalizeText(queryText);
  if (!normalizedQuery || corpus.length === 0) {
    return corpus.map(item => ({ ...item, score: 0 }));
  }

  const queryEmbeddingResult = await embedTexts([normalizedQuery]);
  const queryEmbedding =
    queryEmbeddingResult.vectors[0] || hashEmbedText(normalizedQuery);
  const corpusEmbeddings = await embedTexts(
    corpus.map(item => `${item.document.title}\n${item.document.contentPreview}\n${item.combinedContent}`),
  );

  return corpus
    .map((item, index) => {
      const score = scoreMemoryCandidate({
        queryText: normalizedQuery,
        queryEmbedding,
        document: item.document,
        content: `${item.document.title}\n${item.document.contentPreview}\n${item.combinedContent}`,
        embedding: corpusEmbeddings.vectors[index] || hashEmbedText(item.combinedContent),
      });
      return {
        ...item,
        score: score.rerankScore,
      };
    })
    .sort((left, right) => right.score - left.score);
};

export const getCapabilityMemoryCorpus = async (
  capabilityId: string,
  agentId?: string,
) => {
  const sourceFilter = await getAgentSourceFilter(capabilityId, agentId);
  if (sourceFilter && sourceFilter.size === 0) {
    return [] as Array<{
      document: MemoryDocument;
      chunks: MemoryChunk[];
      combinedContent: string;
    }>;
  }

  const result = await query(
    `
      SELECT
        docs.*,
        chunks.id AS chunk_id,
        chunks.chunk_index,
        chunks.content,
        chunks.token_estimate,
        chunks.metadata AS chunk_metadata,
        chunks.created_at AS chunk_created_at
      FROM capability_memory_documents docs
      LEFT JOIN capability_memory_chunks chunks
        ON chunks.capability_id = docs.capability_id
       AND chunks.document_id = docs.id
      WHERE (docs.capability_id = $1 OR docs.is_global = TRUE)
      ORDER BY docs.updated_at DESC, docs.id DESC, chunks.chunk_index ASC
    `,
    [capabilityId],
  );

  const byDocument = new Map<
    string,
    {
      document: MemoryDocument;
      chunks: MemoryChunk[];
      combinedContent: string;
    }
  >();

  result.rows.forEach(row => {
    const record = row as Record<string, any>;
    const document = documentFromRow(record);
    // Global documents bypass per-agent source filters.
    if (!document.isGlobal && sourceFilter && !sourceFilter.has(document.id)) {
      return;
    }

    const existing =
      byDocument.get(document.id) ||
      {
        document,
        chunks: [],
        combinedContent: '',
      };

    if (record.chunk_id) {
      const chunk = chunkFromRow(record);
      existing.chunks.push(chunk);
      existing.combinedContent = existing.chunks
        .map(current => current.content)
        .filter(Boolean)
        .join('\n\n');
    } else if (!existing.combinedContent) {
      existing.combinedContent = document.contentPreview;
    }

    byDocument.set(document.id, existing);
  });

  return [...byDocument.values()];
};

export const buildMemoryContext = async ({
  capabilityId,
  agentId,
  queryText,
  limit = 5,
  excludeSourceTypes = [],
}: {
  capabilityId: string;
  agentId?: string;
  queryText: string;
  limit?: number;
  excludeSourceTypes?: MemorySourceType[];
}) => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<{
      results: MemorySearchResult[];
      prompt: string;
    }>('buildMemoryContext', {
      capabilityId,
      agentId,
      queryText,
      limit,
      excludeSourceTypes,
    });
  }

  const capabilityBundle = await getCapabilityBundle(capabilityId).catch(() => null);
  const tokenPolicy = resolveTokenOptimizationPolicy(capabilityBundle?.capability);
  const agentProviderKey =
    capabilityBundle?.workspace.agents.find(candidate => candidate.id === agentId)?.providerKey ||
    capabilityBundle?.workspace.agents.find(candidate => candidate.id === agentId)?.provider;
  const agentModel =
    capabilityBundle?.workspace.agents.find(candidate => candidate.id === agentId)?.model;
  const results = await searchCapabilityMemory({
    capabilityId,
    agentId,
    queryText,
    limit,
    excludeSourceTypes,
  });
  return {
    results,
    prompt: buildBudgetedMemoryPrompt({
      results,
      providerKey: agentProviderKey,
      model: agentModel,
      maxPromptTokens: tokenPolicy.memoryPromptMaxTokens,
      perChunkMaxTokens: tokenPolicy.memoryChunkMaxTokens,
    }),
  };
};

/**
 * Persist a memory document that is globally visible to every capability.
 *
 * The `capabilityId` parameter identifies the writing capability (provenance);
 * the document's chunks and embeddings are stored under that capability so
 * the standard JOIN conditions continue to work without schema changes to the
 * child tables.
 *
 * Only capabilities whose `executionConfig.globalMemory.canWrite` is `true`
 * should call this function — callers are responsible for checking that guard
 * before invoking.
 */
export const writeGlobalMemoryDocument = async ({
  capabilityId,
  title,
  content,
  sourceType,
  tier,
  sourceId,
  sourceUri,
  freshness,
  metadata,
}: {
  capabilityId: string;
  title: string;
  content: string;
  sourceType: MemorySourceType;
  tier: MemoryStoreTier;
  sourceId?: string;
  sourceUri?: string;
  freshness?: MemoryDocument['freshness'];
  metadata?: Record<string, any>;
}): Promise<MemoryDocument> => {
  const id = createMemoryDocumentId(capabilityId, sourceType, sourceId || slugify(title));
  const contentPreview = content.slice(0, 500);

  // Build a single chunk for the full content.
  const embeddingResult = await embedTexts([normalizeText(content) || content]);
  const vectorModel = embeddingResult.model;
  const vector = embeddingResult.vectors[0] || hashEmbedText(content);
  const chunkId = `${id}-C0`;
  const tokenEstimate = Math.ceil(content.length / 4);

  const chunks: MemoryRefreshChunkPlan[] = [
    {
      id: chunkId,
      embeddingId: `EMB-${chunkId}`,
      chunkIndex: 0,
      content,
      tokenEstimate,
      metadata: {},
      embedding: vector,
    },
  ];

  await transaction(async executor => {
    await upsertMemoryDocument({
      executor,
      capabilityId,
      id,
      title,
      sourceType,
      tier,
      sourceId,
      sourceUri,
      freshness,
      metadata,
      contentPreview,
      isGlobal: true,
      vectorModel,
      chunks,
    });
  });

  return {
    id,
    capabilityId,
    title,
    sourceType,
    tier,
    sourceId,
    sourceUri,
    freshness,
    metadata,
    contentPreview,
    isGlobal: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};
