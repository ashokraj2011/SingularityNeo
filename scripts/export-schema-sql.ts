import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getPlatformFeatureState,
  migrationStatements,
  schemaStatements,
} from '../server/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sqlOutputDir = path.join(repoRoot, 'docs', 'sql');
const outputPath = path.join(sqlOutputDir, 'singularityneo_schema.sql');

const ensureTerminated = (statement: string) => {
  const trimmed = statement.trim();
  if (!trimmed) return '';
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
};

const joinStatements = (statements: string[]) =>
  statements.map(ensureTerminated).filter(Boolean).join('\n\n');

const { memoryEmbeddingDimensions } = getPlatformFeatureState();

const vectorBlock = `-- Optional pgvector acceleration. Safe to leave in place on instances without pgvector.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION
    WHEN undefined_file THEN
      RAISE NOTICE 'pgvector is not available; skipping vector extension.';
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'capability_memory_embeddings'
        AND column_name = 'embedding_vector'
    ) THEN
      EXECUTE 'ALTER TABLE capability_memory_embeddings ADD COLUMN embedding_vector vector(${memoryEmbeddingDimensions})';
    END IF;

    EXECUTE 'CREATE INDEX IF NOT EXISTS capability_memory_embeddings_vector_idx ON capability_memory_embeddings USING hnsw (embedding_vector vector_cosine_ops)';
  ELSE
    RAISE NOTICE 'pgvector extension is not installed; using JSON embedding storage only.';
  END IF;
END $$;
`;

const content = `-- Singularity Neo PostgreSQL schema export
-- Source: server/db.ts
-- Purpose: recreate the persistent backend objects in another implementation.
-- Notes:
--   1. Run this against an existing PostgreSQL database. Database creation is not included.
--   2. JSONB, array, and TIMESTAMPTZ types are used throughout.
--   3. pgvector acceleration is optional; the DO block at the end enables it only when available.

BEGIN;

-- Base schema

${joinStatements(schemaStatements)}

-- Migration-safe updates

${joinStatements(migrationStatements)}

${vectorBlock}

COMMIT;
`;

mkdirSync(sqlOutputDir, { recursive: true });
writeFileSync(outputPath, content);

console.log('Exported schema SQL to', outputPath);

