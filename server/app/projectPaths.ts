import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const projectRoot = path.resolve(__dirname, '../..');
export const distDir = path.resolve(projectRoot, 'dist');
export const envLocalPath = path.resolve(projectRoot, '.env.local');
export const databaseBootstrapStatePath = path.resolve(
  projectRoot,
  '.singularity',
  'database-runtime.json',
);
