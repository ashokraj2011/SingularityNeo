import fs from 'node:fs';
import path from 'node:path';
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
import { getPlatformFeatureState, query, transaction } from './db';
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
import { getWorkspaceFileIndex } from './workspaceIndex';

const EMBEDDING_DIMENSIONS = getPlatformFeatureState().memoryEmbeddingDimensions;

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

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
): Promise<{
  providerKey: EmbeddingProviderKey;
  model: string;
  vectors: number[][];
}> => {
  const response = await requestLocalOpenAIEmbeddings({
    texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  if (response.providerKey === DEFAULT_EMBEDDING_PROVIDER_KEY && response.vectors.length === texts.length) {
    return response;
  }

  return {
    providerKey: HASH_EMBEDDING_PROVIDER_KEY,
    model: 'deterministic-hash-v2',
    vectors: texts.map(text => hashEmbedText(text)),
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
  capabilityId,
  documentId,
  chunks,
}: {
  capabilityId: string;
  documentId: string;
  chunks: Array<{ content: string; metadata?: Record<string, any> }>;
}) => {
  await query(
    'DELETE FROM capability_memory_chunks WHERE capability_id = $1 AND document_id = $2',
    [capabilityId, documentId],
  );
  await query(
    'DELETE FROM capability_memory_embeddings WHERE capability_id = $1 AND document_id = $2',
    [capabilityId, documentId],
  );

  const embeddingResult = await embedTexts(chunks.map(chunk => chunk.content));

  for (const [index, chunk] of chunks.entries()) {
    const chunkId = createId('MEMCHUNK');
    const embeddingId = createId('MEMEMBED');
    const embedding = embeddingResult.vectors[index] || hashEmbedText(chunk.content);
    await query(
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
        chunkId,
        documentId,
        index,
        chunk.content,
        approxTokenEstimate(chunk.content),
        chunk.metadata || {},
      ],
    );
    await query(
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
        embeddingId,
        documentId,
        chunkId,
        embeddingResult.model,
        JSON.stringify(embedding),
      ],
    );

    if (getPlatformFeatureState().pgvectorAvailable) {
      await query(
        `
          UPDATE capability_memory_embeddings
          SET embedding_vector = $3::vector
          WHERE capability_id = $1 AND id = $2
        `,
        [capabilityId, embeddingId, serializeVector(embedding)],
      );
    }
  }
};

const upsertMemoryDocument = async ({
  capabilityId,
  id,
  title,
  sourceType,
  tier,
  sourceId,
  sourceUri,
  freshness,
  metadata,
  content,
}: {
  capabilityId: string;
  id: string;
  title: string;
  sourceType: MemorySourceType;
  tier: MemoryStoreTier;
  sourceId?: string;
  sourceUri?: string;
  freshness?: MemoryDocument['freshness'];
  metadata?: Record<string, any>;
  content: string;
}) => {
  const preview = normalizeText(content).slice(0, 400);
  await query(
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
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      ON CONFLICT (capability_id, id) DO UPDATE SET
        title = EXCLUDED.title,
        source_type = EXCLUDED.source_type,
        tier = EXCLUDED.tier,
        source_id = EXCLUDED.source_id,
        source_uri = EXCLUDED.source_uri,
        freshness = EXCLUDED.freshness,
        metadata = EXCLUDED.metadata,
        content_preview = EXCLUDED.content_preview,
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
      preview,
    ],
  );

  await replaceDocumentChunksTx({
    capabilityId,
    documentId: id,
    chunks: splitIntoChunks(content).map(chunk => ({ content: chunk })),
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
      ? `Approved workspace paths: ${capability.executionConfig.allowedWorkspacePaths.join(', ')}`
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
) => {
  const sources: Array<{
    id: string;
    title: string;
    sourceType: MemorySourceType;
    tier: MemoryStoreTier;
    sourceUri?: string;
    sourceId?: string;
    metadata?: Record<string, any>;
    content: string;
  }> = [
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
    sources.push({
      id: createMemoryDocumentId(capability.id, 'CHAT_SESSION', `${capability.id}-session`),
      title: `${capability.name} Recent Chat Session`,
      sourceType: 'CHAT_SESSION',
      tier: 'SESSION',
      sourceId: `${capability.id}-session`,
      metadata: {
        messageCount: recentMessages.length,
      },
      content: recentMessages
        .map(message => `${message.role.toUpperCase()}: ${message.content}`)
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

const buildRepositoryFileSources = async (capability: Capability) => {
  const repoSources: Array<{
    id: string;
    title: string;
    sourceType: MemorySourceType;
    tier: MemoryStoreTier;
    sourceUri?: string;
    sourceId?: string;
    metadata?: Record<string, any>;
    content: string;
  }> = [];

  for (const directoryPath of getCapabilityWorkspaceRoots(capability)) {
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
      .sort((left, right) => right.score - left.score)
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

  await transaction(async () => {
    for (const source of sources) {
      await upsertMemoryDocument({
        capabilityId,
        id: source.id,
        title: source.title,
        sourceType: source.sourceType,
        tier: source.tier,
        sourceId:
          source.sourceId ||
          source.metadata?.artifactId ||
          source.metadata?.workItemId ||
          source.metadata?.capabilityId ||
          source.id,
        sourceUri: source.sourceUri,
        freshness: source.tier === 'WORKING' ? 'HOT' : source.tier === 'SESSION' ? 'WARM' : 'COLD',
        metadata: source.metadata,
        content: source.content,
      });
    }
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
      WHERE capability_id = $1
      ORDER BY updated_at DESC, id DESC
    `,
    [capabilityId],
  );

  return result.rows
    .map(documentFromRow)
    .filter(document => {
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
}: {
  capabilityId: string;
  agentId?: string;
  queryText: string;
  limit?: number;
}): Promise<MemorySearchResult[]> => {
  const normalizedQuery = normalizeText(queryText);
  if (!normalizedQuery) {
    return [];
  }
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
      WHERE docs.capability_id = $1
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
        embeddingProviderKey: queryEmbeddingResult.providerKey,
        vectorModel: String(record.vector_model || queryEmbeddingResult.model || ''),
      };
    })
    .sort((left, right) => (right.reference.rerankScore || 0) - (left.reference.rerankScore || 0))
    .filter(item => {
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
      WHERE docs.capability_id = $1
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
    if (sourceFilter && !sourceFilter.has(document.id)) {
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
}: {
  capabilityId: string;
  agentId?: string;
  queryText: string;
  limit?: number;
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
    });
  }

  const results = await searchCapabilityMemory({ capabilityId, agentId, queryText, limit });
  return {
    results,
    prompt:
      results.length > 0
        ? results
            .map(
              (result, index) =>
                `[Memory ${index + 1}] ${result.document.title} (${result.document.sourceType}, ${result.document.tier})\n${result.chunk.content}`,
            )
            .join('\n\n')
        : '',
  };
};
