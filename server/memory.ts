import fs from 'node:fs';
import path from 'node:path';
import type {
  Capability,
  CapabilityWorkspace,
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
import { getCapabilityWorkspaceRoots } from './workspacePaths';

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

const embedText = (content: string) => {
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

  for (const [index, chunk] of chunks.entries()) {
    const chunkId = createId('MEMCHUNK');
    const embeddingId = createId('MEMEMBED');
    const embedding = embedText(chunk.content);
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
        'deterministic-hash-v1',
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
        artifact.artifactKind === 'INPUT_NOTE' || artifact.artifactKind === 'CONFLICT_RESOLUTION'
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

const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);

const collectRepositoryFiles = (directoryPath: string, limit = 12) => {
  const resolvedRoot = path.resolve(directoryPath);
  if (!fs.existsSync(resolvedRoot)) {
    return [] as Array<{ absolutePath: string; relativePath: string }>;
  }

  const matches: Array<{ absolutePath: string; relativePath: string; score: number }> = [];

  const visit = (currentPath: string, depth: number) => {
    if (matches.length >= limit) {
      return;
    }

    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= limit) {
        return;
      }

      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(resolvedRoot, absolutePath);

      if (entry.isDirectory()) {
        if (depth >= 3 || SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }
        visit(absolutePath, depth + 1);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      const isReadme = /^readme/i.test(entry.name);
      const isDocPath = relativePath.startsWith(`docs${path.sep}`);
      const isConfig =
        entry.name === 'package.json' ||
        entry.name === 'pyproject.toml' ||
        entry.name === 'requirements.txt' ||
        entry.name === 'setup.py' ||
        entry.name === 'Pipfile' ||
        entry.name === 'pytest.ini' ||
        entry.name === 'tox.ini' ||
        entry.name === 'tsconfig.json' ||
        entry.name.endsWith('.config.ts') ||
        entry.name.endsWith('.config.js');

      if (!(isReadme || isDocPath || isConfig || TEXT_EXTENSIONS.has(extension))) {
        continue;
      }

      try {
        const stat = fs.statSync(absolutePath);
        if (stat.size > 80_000) {
          continue;
        }
      } catch {
        continue;
      }

      let score = 10;
      if (isReadme) score += 50;
      if (isDocPath) score += 30;
      if (isConfig) score += 20;
      if (/artifact|workflow|design|requirement|runbook|architecture/i.test(relativePath)) {
        score += 12;
      }

      matches.push({ absolutePath, relativePath, score });
    }
  };

  visit(resolvedRoot, 0);

  return matches
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ absolutePath, relativePath }) => ({ absolutePath, relativePath }));
};

const buildRepositoryFileSources = (capability: Capability) => {
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

  getCapabilityWorkspaceRoots(capability).forEach(directoryPath => {
    collectRepositoryFiles(directoryPath).forEach(file => {
      try {
        const content = fs.readFileSync(file.absolutePath, 'utf8').trim();
        if (!content) {
          return;
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
    });
  });

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
  const bundle = await getCapabilityBundle(capabilityId);
  const sources = [
    ...buildSources(bundle.capability, bundle.workspace),
    ...buildRepositoryFileSources(bundle.capability),
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
        embeddings.embedding_json
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

  const queryEmbedding = embedText(normalizedQuery);
  return result.rows
    .map(row => {
      const record = row as Record<string, any>;
      const embedding = Array.isArray(record.embedding_json)
        ? record.embedding_json.map((value: unknown) => Number(value || 0))
        : [];
      const document = documentFromRow(record);
      const chunk = chunkFromRow(record);
      const score = cosineSimilarity(queryEmbedding, embedding);

      return {
        reference: {
          documentId: document.id,
          chunkId: chunk.id,
          title: document.title,
          sourceType: document.sourceType,
          tier: document.tier,
          score,
        } satisfies MemoryReference,
        document,
        chunk,
      };
    })
    .sort((left, right) => (right.reference.score || 0) - (left.reference.score || 0))
    .filter(item => {
      if (sourceFilter === null) {
        return true;
      }
      return sourceFilter.has(item.document.id);
    })
    .slice(0, limit);
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
