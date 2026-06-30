import { getRequestListener } from '@hono/node-server';
import type { Connect, Plugin } from 'vite';
import { app } from './app';

/**
 * Mounts the Hono API into Vite's dev AND preview servers, so `pnpm dev`
 * and `pnpm build && pnpm start` expose the same /api on the same port.
 */
export function apiPlugin(): Plugin {
  const listener = getRequestListener(app.fetch);
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.startsWith('/api') || req.url?.startsWith('/mcp')) {
      void listener(req, res);
    } else {
      next();
    }
  };
  return {
    name: 'mind-map-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
