import express from 'express';
import fs from 'node:fs';
import multer from 'multer';
import { resolveCorsOriginHeader } from '../domains/platform';
import { distDir } from './projectPaths';
import { registerAllRoutes } from './registerRoutes';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5,
  },
});

export const buildApp = () => {
  const app = express();

  app.use((request, response, next) => {
    const requestOrigin = request.header('origin');
    const allowedOrigin = resolveCorsOriginHeader(requestOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'x-singularity-actor-user-id',
        'x-singularity-actor-display-name',
        'x-singularity-actor-team-ids',
        'x-singularity-actor-stakeholder-ids',
      ].join(', '),
    );
    if (allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    }

    if (request.method === 'OPTIONS') {
      if (requestOrigin && !allowedOrigin) {
        response.status(403).json({ error: `Origin ${requestOrigin} is not allowed.` });
        return;
      }
      response.sendStatus(204);
      return;
    }

    if (requestOrigin && !allowedOrigin) {
      response.status(403).json({ error: `Origin ${requestOrigin} is not allowed.` });
      return;
    }

    next();
  });

  app.use(
    express.json({
      limit: '12mb',
      verify: (request, _response, buffer) => {
        (request as express.Request & { rawBody?: string }).rawBody = buffer.toString('utf8');
      },
    }),
  );

  registerAllRoutes(app, upload.array('files', 5));

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api).*/, (_request, response) => {
      response.sendFile(`${distDir}/index.html`);
    });
  }

  return app;
};
