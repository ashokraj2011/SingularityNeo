import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app/buildApp';
import { startServer } from './app/startServer';

export { buildApp, startServer };

const app = buildApp();

const shouldAutoStartServer = () => {
  const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
  const currentFile = fileURLToPath(import.meta.url);
  return Boolean(entryFile) && entryFile === currentFile;
};

if (shouldAutoStartServer()) {
  void startServer(app).catch(error => {
    console.error('Failed to start Singularity Neo API.', error);
    process.exit(1);
  });
}
