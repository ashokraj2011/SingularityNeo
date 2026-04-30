import type express from 'express';
import dotenv from 'dotenv';
import { buildRuntimeStatus } from '../domains/model-policy';
import {
  closeDatabasePool,
  ensurePersistentWorkspaceInitialization,
  hydratePersistedDatabaseBootstrapRuntime,
  reconcileDesktopExecutionOwnerships,
} from './runtimeBootstrap';

dotenv.config({ path: '.env.local' });
dotenv.config();

const port = Number(process.env.PORT || '3001');

export const startServer = async (serverApp: express.Express) => {
  await hydratePersistedDatabaseBootstrapRuntime().catch(error => {
    console.warn(
      'Unable to restore the last saved database runtime profile. Falling back to environment defaults.',
      error,
    );
  });
  void ensurePersistentWorkspaceInitialization().catch(error => {
    console.error(
      'Singularity Neo started without a ready database. Open /workspace/databases to configure or repair the connection.',
      error,
    );
  });
  const server = serverApp.listen(port);
  server.on('listening', () => {
    console.log(`Singularity Neo API listening on http://localhost:${port}`);
    void buildRuntimeStatus()
      .then(status => {
        console.log(`Runtime preflight: ${status.readinessState || 'unknown'}.`);
        (status.checks || [])
          .filter(check => check.status !== 'healthy')
          .slice(0, 6)
          .forEach(check => {
            console.warn(
              `[preflight:${check.status}] ${check.label}: ${check.message}` +
                (check.remediation ? ` Remediation: ${check.remediation}` : ''),
            );
          });
      })
      .catch(error => {
        console.warn(
          'Runtime preflight could not complete.',
          error instanceof Error ? error.message : error,
        );
      });
  });

  const reconciliationInterval = setInterval(() => {
    void reconcileDesktopExecutionOwnerships().catch(err => {
      console.error('[reconcile] background reconciliation failed:', err);
    });
  }, 30_000);
  reconciliationInterval.unref();
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Singularity Neo API could not start because port ${port} is already in use. ` +
          `Stop the existing backend process or start this server with PORT=<free-port>.`,
      );
      process.exit(1);
    }

    console.error('Singularity Neo API listener failed.', error);
    process.exit(1);
  });

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} — draining connections…`);
    server.close(async () => {
      await closeDatabasePool();
      console.log('[server] clean exit');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[server] forced exit: drain timeout exceeded');
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
};
